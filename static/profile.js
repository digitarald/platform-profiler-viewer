import React from 'react';
import firebase from 'firebase/app';
import { arc, pie } from 'd3-shape';
import { scaleOrdinal, scaleLinear, schemeCategory10 } from 'd3-scale';
import { UniqueStringArray } from './profile/unique-string-array';
import { getFuncStackInfo, getSampleFuncStacks } from './profile/profile-data';

const bucketMapping = [
  {
    needle: /^mach_msg_trap/,
    bucket: 'idle',
  },
  {
    needle: /ResolveStyleContext/,
    bucket: 'css:resolve',
    parent: 'css:',
  },
  {
    needle: /ProcessPendingRestyles/,
    bucket: 'css:restyle',
    parent: 'css:',
  },
  {
    needle: /^nsRuleNode::WalkRuleTree/,
    bucket: 'css:walkrtree',
    parent: 'css:',
  },
  {
    needle: /ProcessReflowCommands/,
    bucket: 'reflow',
  },
  // {
  //   needle: /^mozilla::gl/,
  //   bucket: "graphics:webgl"
  // },
  {
    needle: /^PresShell::Paint/,
    bucket: 'paint',
  },
  // {
  //   needle: /BuildDisplayList/,
  //   bucket: "paint:displaylist"
  // },
  // {
  //   needle: /^DisplayList::Draw/,
  //   bucket: "paint:draw"
  // },
  {
    needle: /^js::frontend::CompileScript|createScriptForLazilyInterpretedFunction/,
    bucket: 'jit:*',
  },
  {
    needle: /^js::jit::BaselineCompile/,
    bucket: 'jit:base',
  },
  {
    needle: /^js::jit::IonBuilder::build/,
    bucket: 'jit:ion',
  },
  {
    needle: /^js::InternalCallOrConstruct|^JS::Call|^js::RunScript/,
    bucket: 'js:run:*',
  },
  {
    needle: /^Interpret/,
    bucket: 'js:interpret',
  },
  {
    needle: /^EnterBaseline/,
    bucket: 'js:base',
  },
  {
    needle: /^js::jit::IonCannon/,
    bucket: 'js:ion',
  },
  {
    needle: /^BytecodeCompiler::compileScript/,
    bucket: 'parse:js',
  },
  {
    needle: /^js::gc::GCRuntime::minorGCImpl/,
    bucket: 'gc:nursery',
  },
  {
    needle: /^nsJSContext::GarbageCollectNow/,
    bucket: 'gc:collect',
  },
  // {
  //   needle: /^GeckoSampler/,
  //   bucket: "profile"
  // },
  // {
  //   needle: /^IPDL::PNecko|^nsHttpChannel::On/,
  //   bucket: 'net',
  // },
  // {
  //   needle: /^mozilla::dom::GenericBindingMethod/,
  //   bucket: 'dom',
  // },
  // {
  //   needle: /^mozilla::ipc::MessageChannel/,
  //   bucket: 'ipc',
  // },
];

const categories = bucketMapping.reduce((colors, mapping) => {
  mapping.category = mapping.bucket.split(':')[0];
  if (!colors.includes(mapping.category)) {
    colors.push(mapping.category);
  }
  return colors;
}, ['*']);

function getTimeline(thread) {
  const {
    funcStackTable,
    stackIndexToFuncStackIndex,
  } = getFuncStackInfo(thread.stackTable, thread.frameTable, thread.funcTable);
  const sampleFuncStacks = getSampleFuncStacks(thread.samples, stackIndexToFuncStackIndex);
  return sampleFuncStacks
    .map((funcStackIndex) => {
      const callStack = [funcStackIndex];
      let parentIndex = funcStackIndex;
      while ((parentIndex = funcStackTable.prefix[parentIndex]) !== -1) {
        callStack.push(parentIndex);
      }
      return callStack;
    })
    .reduce((results, callStack) => {
      const last = results[results.length - 1];
      if (last && last.callStack.join(',') === callStack.join(',')) {
        last.intervals += 1;
        return results;
      }
      results.push({
        callStack,
        intervals: 1,
      });
      return results;
    }, [])
    .map((sample) => {
      sample.callStack = sample.callStack.map((index) => {
        return thread.stringTable
          .getString(thread.funcTable.name[funcStackTable.func[index]]);
      });
      return sample;
    });
}


export default class App extends React.Component {
  static propTypes = {
    profile: React.PropTypes.object,
    params: React.PropTypes.object,
  }

  state = {}

  componentWillMount() {
    const profileKey = this.props.params && this.props.params.profileKey;
    if (profileKey) {
      this.load(profileKey);
    }
  }

  async load(key) {
    const url = await firebase.storage().ref().child(`profiles/${key}`).getDownloadURL();
    const profile = await (await window.fetch(url)).json();
    profile.threads.forEach((thread) => {
      thread.stringTable = new UniqueStringArray(thread.stringTable);
    });
    this.setState({ profile });
  }

  render() {
    const profile = this.props.profile || this.state.profile;
    if (!profile) {
      return (
        <div>Loading …</div>
      );
    }
    const thread = profile.threads[0];

    const buckets = categories.map((category) => {
      return {
        category: category,
        top: 0,
        tail: 0,
        stacks: [],
      };
    });

    const meta = profile.meta;
    const perf = meta.performance;
    const times = thread.samples.time;
    const startTime = meta.startTime + times[0];
    const duration = (times[times.length - 1] - times[0]);
    const skipTime = (perf.timing.unloadEventEnd || perf.timing.responseStart) - startTime;
    let skipping = Math.floor(skipTime / meta.interval);

    console.time('combinedTimeline');
    const categorizedTimeline = getTimeline(thread)
      .filter(({ intervals }) => (skipping -= intervals) <= 0)
      .map((sample) => {
        const bucketMatches = [];
        let lastMatch = null;
        for (const func of sample.callStack) {
          for (const map of bucketMapping) {
            if (map.needle.test(func) && lastMatch !== map.category) {
              bucketMatches.push(map.category);
              lastMatch = map.category;
              break;
            }
          }
        }
        if (!bucketMatches.length) {
          bucketMatches.push(null);
        }
        sample.bucketMatches = bucketMatches;
        return sample;
      });
    const combinedTimeline = categorizedTimeline
      .filter((sample, idx, samples) => {
        const lastSample = samples[idx - 1];
        if (lastSample && String(lastSample.bucketMatches) === String(sample.bucketMatches)) {
          lastSample.intervals += sample.intervals;
          return false;
        }
        return true;
      });

    const flamegraph = combinedTimeline
      .reduce((result, sample) => {
        const { timeline, windowSlices } = result;
        const top = Math.max(windowSlices.length, sample.bucketMatches.length);
        result.tops = Math.max(result.tops, top);
        for (let i = 0; i < top; i++) {
          let currentSlice = windowSlices[i];
          const currentBucket = sample.bucketMatches[top - i];
          if (currentSlice) {
            if (currentSlice.bucket !== currentBucket) {
              windowSlices.splice(i);
            }
          }
          if (currentBucket && !currentSlice) {
            currentSlice = {
              bucket: currentBucket,
              start: result.intervals,
              top: i,
              intervals: 0,
            };
            windowSlices[i] = currentSlice;
            timeline.push(currentSlice);
          }
          if (currentSlice) {
            currentSlice.intervals += sample.intervals;
          }
        }
        result.intervals += sample.intervals;
        return result;
      }, { timeline: [], windowSlices: [], intervals: 0, tops: 0 });

    combinedTimeline.forEach((sample) => {
      const included = new Set();
      sample.bucketMatches.forEach((category, idx) => {
        category = category || '*';
        if (included.has(category)) {
          return;
        }
        included.add(category);
        const bucket = buckets.find(entry => entry.category === category);
        if (!idx) {
          bucket.top += sample.intervals;
        } else {
          bucket.tail += sample.intervals;
        }
      });
    });
    console.timeEnd('combinedTimeline');

    const interval = profile.meta.interval;

    const graphWidth = window.innerWidth - 100;

    const bucketArc = arc()
      .innerRadius(100)
      .outerRadius(150);
    const bucketPie = pie()
      .padAngle(0.01)
      .value((bucket) => bucket.top)
      .sort(null);
    const bucketColor = scaleOrdinal(schemeCategory10)
      .domain([0, buckets.length]);
    const flameScale = scaleLinear()
      .domain([0, flamegraph.intervals])
      .range([0, graphWidth]);
    const flameScaleTop = scaleLinear()
      .domain([0, flamegraph.tops])
      .range([0, 200]);

    const $flamegraph = (
      <svg height={300} width={graphWidth}>
        {flamegraph.timeline.map((bar, idx) => {
          const color = bucketColor(categories.indexOf(bar.bucket));
          const start = flameScale(bar.start);
          const width = flameScale(bar.intervals);
          const top = flameScaleTop(bar.top);
          const height = flameScaleTop(1);
          return (
            <rect
              key={`bar-${idx}`}
              x={start}
              y={top}
              width={width}
              height={height}
              fill={color}
              title={bar.bucket}
            />
          );
        })}
      </svg>
    );

    const $pie = (
      <svg height={300} width={300}>
        <g transform={`translate(${150}, ${150})`}>
          {bucketPie(buckets).map((slice) => {
            const color = bucketColor(slice.index);
            const d = bucketArc(slice);
            return (
              <path
                key={`arc-${slice.index}`}
                fill={color}
                title={buckets[slice.index].category}
                d={d}
              />
            );
          })}
        </g>
      </svg>
    );

    let bucketSum = 0.0;
    const $buckets = buckets.map(({ category, top, tail, stacks }, idx) => {
      bucketSum += top * interval;

      return (
        <li
          className='bucket'
          key={`bucket-${idx}`}
          style={{
            backgroundColor: bucketColor(idx),
          }}
        >
          <span className='bucket-label'>{category}</span>
          <span className='bucket-time'>
            {(top * interval).toFixed(1)}ms / {(tail * interval).toFixed(1)}ms
          </span>
        </li>
      );
    });

    return (
      <div>
        <h1>{profile.meta.url}</h1>
        <h2>{duration.toFixed(1)}ms samples, {(bucketSum).toFixed(1)} buckets</h2>
        {$flamegraph}
        <div className='row'>
          {$pie}
          <ul key='buckets' className='buckets'>{$buckets}</ul>
        </div>
      </div>
    );
  }
}
