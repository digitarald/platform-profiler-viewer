import React from 'react';
// import update from "react-addons-update";
import firebase from 'firebase/app';
import { Link } from 'react-router';
import Profile from './profile';
import { preprocessProfile } from './profile/preprocess-profile';
import {
  symbolicateProfile,
  applyFunctionMerging,
  setFuncNames,
} from './profile/symbolication';
import { SymbolStore } from './profile/symbol-store';

export default class Home extends React.Component {
  state = {
    loading: 'Connecting',
    profiles: null,
  }

  componentWillMount() {
    window.connectToGeckoProfiler = this.connectToGeckoProfiler.bind(this);
    window.setTimeout(this.loadAll.bind(this), 2500);
  }

  didConnect = false;

  async loadAll() {
    if (this.didConnect) {
      return;
    }
    this.setState({ loading: 'Loading Profiles' });
    const snapshots = await firebase.database().ref('profiles').once('value');
    const profiles = [];
    snapshots.forEach((snapshot) => {
      profiles.push({
        key: snapshot.key,
        url: snapshot.val().url,
        date: new Date(parseInt(snapshot.key, 10)),
        duration: snapshot.val().duration,
      });
    });
    this.setState({ loading: null, profiles });
  }

  async store(profile) {
    const times = profile.threads[0].samples.time;
    const key = Math.round(profile.meta.startTime + times[0]);
    const duration = (times[times.length - 1] - times[0]);
    const ref = firebase.database().ref(`profiles/${key}`);
    if ((await ref.once('value')).exists()) {
      console.warn(`Profile ${key} already stored`);
      return false;
    }
    await ref.set({
      duration: duration,
      url: profile.meta.url,
      version: profile.meta.misc,
      platform: profile.meta.platform,
      started: profile.meta.startTime,
    });
    const stringified = JSON.stringify({
      meta: profile.meta,
      threads: profile.threads.map((thread) => {
        const cloned = Object.assign({}, thread);
        // eslint-disable-next-line
        cloned.stringTable = cloned.stringTable._array;
        return cloned;
      }),
    });
    const blob = new Blob([stringified], { type: 'application/json' });
    const task = firebase.storage().ref().child(`profiles/${key}`).put(blob);
    await new Promise((resolve, reject) => {
      task.on('state_changed', (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log('Upload is %d% done', progress);
      }, reject, resolve);
    });
    return true;
  }

  async connectToGeckoProfiler({ getProfile, getSymbolTable }) {
    console.log('connectToGeckoProfiler');
    if (this.didConnect) {
      return;
    }
    this.didConnect = true;
    this.setState({
      loading: 'Processing Profile',
    });
    const unprocessed = await getProfile();
    const profile = preprocessProfile(unprocessed);

    const contentThread = profile.threads
      .filter(({ name }) => name === 'Content')
      .sort((a, b) => b.samples.time[0] - a.samples.time[0])[0];
    // const mainThread = profile.threads
    //   .filter(({ name }) => name === 'GeckoMain')[0];

    profile.threads = [contentThread];

    console.time('new SymbolStore');
    const symbolStore = new SymbolStore('cleopatra-async-storage', {
      requestSymbolTable: (pdbName, breakpadId) => {
        return getSymbolTable(pdbName, breakpadId);
      },
    });
    console.timeEnd('new SymbolStore');

    console.time('symbolicateProfile');
    await symbolicateProfile(profile, symbolStore, {
      onMergeFunctions: (threadIndex, oldFuncToNewFuncMap) => {
        applyFunctionMerging(profile.threads[threadIndex], oldFuncToNewFuncMap);
      },
      onGotFuncNames: (threadIndex, funcIndices, funcNames) => {
        setFuncNames(profile.threads[threadIndex], funcIndices, funcNames);
      },
    });
    console.timeEnd('symbolicateProfile');

    this.setState({
      loading: 'Uploading Profile',
    });
    this.store(profile);

    this.setState({
      profile: profile,
      loading: null,
    });
  }

  render() {
    const { loading, profile, profiles } = this.state;
    if (loading) {
      return (
        <div>{loading}</div>
      );
    }
    if (profile) {
      return <Profile profile={profile} />;
    }
    return (
      <ul>
        {profiles.map((entry, idx) => {
          return (
            <li key={`profile-${idx}`}>
              <Link to={`/${entry.key}`}>
                {entry.url} ({entry.duration.toFixed(1)}ms, {entry.date.toLocaleDateString()})
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }
}
