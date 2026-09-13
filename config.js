window.SIGNAL_ROOM_CONFIG = {
  // Set these to the public URLs of your separately hosted MediaMTX server.
  whipBase: 'http://localhost:8889',
  whepBase: 'http://localhost:8889',
  hlsBase: 'http://localhost:8888',
  controlBase: window.location.hostname === 'localhost' ? 'http://localhost:3000' : ''
};