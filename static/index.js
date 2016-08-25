/* global document */
import React from 'react';
import { render } from 'react-dom';
import { AppContainer } from 'react-hot-loader';
import firebase from 'firebase/app';
import 'firebase/database';
import 'firebase/storage';
import './index.css';
import Routes from './routes';

firebase.initializeApp({
  apiKey: 'AIzaSyBHGDg00_mgxmqE_yjHNjVozdBEXz5IRKo',
  authDomain: 'profile-analyzer.firebaseapp.com',
  databaseURL: 'https://profile-analyzer.firebaseio.com',
  storageBucket: 'profile-analyzer.appspot.com',
});

render((
  <AppContainer>
    <Routes />
  </AppContainer>
), document.getElementById('root'));

if (process.env.NODE_ENV !== 'production') {
  const update = () => {
    const NextRoutes = require('./routes').default;

    render((
      <AppContainer>
        <NextRoutes />
      </AppContainer>
    ), document.getElementById('root'));
  };
  if (module.hot) {
    module.hot.accept('./routes', update);
  }
}
