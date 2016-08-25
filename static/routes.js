/* eslint react/no-multi-comp: 0 */
import React, { Component, PropTypes } from 'react';
import { Router, Route, IndexRoute, hashHistory } from 'react-router';

import Home from './home.js';
import Profile from './profile.js';

const NoMatch = () => (<div>404</div>);

class App extends Component {
  render() {
    return React.cloneElement(this.props.children, this.state);
  }
}

App.propTypes = {
  children: PropTypes.oneOfType([PropTypes.array, PropTypes.object]),
};

export default class Routes extends Component {
  render() {
    return (
      <Router history={hashHistory}>
        <Route path='/' component={App}>
          <IndexRoute component={Home} />
          <Route path='/:profileKey' component={Profile} />
        </Route>
        <Route path='*' component={NoMatch} />
      </Router>
    );
  }
}
