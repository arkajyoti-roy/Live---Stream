const SignalRoom = (() => {
  const serverHost = `${window.location.protocol}//${window.location.hostname}`;
  const endpointConfig = window.SIGNAL_ROOM_CONFIG || {};
  const controlBase = endpointConfig.controlBase || '';
  const whipBase = endpointConfig.whipBase || `${serverHost}:8889`;
  const whepBase = endpointConfig.whepBase || `${serverHost}:8889`;
  const hlsBase = endpointConfig.hlsBase || `${serverHost}:8888`;
  const media = { stream: null, peer: null, whipResource: null, channel: 'live' };

  const waitForIce = (peer) => new Promise((resolve) => {
    if (peer.iceGatheringState === 'complete') return resolve();
    const onStateChange = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', onStateChange);
        resolve();
      }
    };
    peer.addEventListener('icegatheringstatechange', onStateChange);
    setTimeout(resolve, 3500);
  });

  const getChannel = (input) => (input.value.trim().replace(/[^a-zA-Z0-9_-]/g, '-') || 'live');
  const setText = (id, text) => { const element = document.getElementById(id); if (element) element.textContent = text; };

  async function startMediaServer() {
    if (!controlBase) return;
    const response = await fetch(`${controlBase}/api/start-mediamtx`, { method: 'POST' });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      throw new Error(details.error || 'Could not start MediaMTX');
    }
  }

  async function publish(channel) {
    media.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const preview = document.getElementById('preview');
    preview.srcObject = media.stream;
    document.getElementById('stage-empty').hidden = true;
    setText('resolution-pill', `${preview.videoWidth || 1280} × ${preview.videoHeight || 720}`);
    media.peer = new RTCPeerConnection();
    media.stream.getTracks().forEach((track) => media.peer.addTrack(track, media.stream));
    const offer = await media.peer.createOffer();
    await media.peer.setLocalDescription(offer);
    await waitForIce(media.peer);
    const response = await fetch(`${whipBase}/${encodeURIComponent(channel)}/whip`, {
      method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: media.peer.localDescription.sdp
    });
    if (!response.ok) throw new Error(`WHIP returned ${response.status}`);
    media.whipResource = response.headers.get('Location');
    await media.peer.setRemoteDescription({ type: 'answer', sdp: await response.text() });
  }

  async function stopPublish() {
    if (media.whipResource) fetch(new URL(media.whipResource, whipBase).href, { method: 'DELETE' }).catch(() => {});
    if (media.peer) media.peer.close();
    if (media.stream) media.stream.getTracks().forEach((track) => track.stop());
    media.peer = null; media.stream = null; media.whipResource = null;
    const preview = document.getElementById('preview');
    preview.srcObject = null;
    document.getElementById('stage-empty').hidden = false;
    const lp = document.getElementById('live-pill'); if (lp) lp.hidden = true;
    setText('resolution-pill', 'NO SIGNAL'); setText('status-metric', 'IDLE');
  }

  function initBroadcast() {
    const channelInput = document.getElementById('channel');
    const start = document.getElementById('start-button');
    const pause = document.getElementById('pause-button');
    const stop = document.getElementById('stop-button');
    const viewerLink = document.querySelector('a[href="view.html"]');
    const syncChannel = () => {
      const channel = getChannel(channelInput);
      setText('channel-readout', channel);
      localStorage.setItem('signalRoomChannel', channel);
      if (viewerLink) viewerLink.href = `view.html?channel=${encodeURIComponent(channel)}`;
    };
    channelInput.addEventListener('input', syncChannel);
    syncChannel();
    start.addEventListener('click', async () => {
      start.disabled = true; channelInput.disabled = true; setText('broadcast-status', 'Requesting camera and opening the live channel...');
      try {
        await startMediaServer();
        media.channel = getChannel(channelInput); localStorage.setItem('signalRoomChannel', media.channel); await publish(media.channel);
        const lp = document.getElementById('live-pill'); if (lp) lp.hidden = false; pause.disabled = false; stop.disabled = false;
        setText('status-metric', 'LIVE'); setText('broadcast-status', 'You are live. Your preview is being transmitted now.');
      } catch (error) {
        await stopPublish(); start.disabled = false; channelInput.disabled = false;
        setText('broadcast-status', error.name === 'NotAllowedError' ? 'Camera permission was denied. Allow access and try again.' : `Could not start: ${error.message}`);
      }
    });
    pause.addEventListener('click', () => {
      const paused = media.stream?.getTracks().some((track) => track.enabled);
      media.stream?.getTracks().forEach((track) => { track.enabled = !paused; });
      pause.textContent = paused ? 'Resume' : 'Pause'; setText('status-metric', paused ? 'PAUSED' : 'LIVE');
      setText('broadcast-status', paused ? 'Transmission paused. Resume when you are ready.' : 'You are live. Your preview is being transmitted now.');
    });
    stop.addEventListener('click', async () => {
      await stopPublish(); start.disabled = false; pause.disabled = true; stop.disabled = true; channelInput.disabled = false; pause.textContent = 'Pause';
      setText('broadcast-status', 'Your camera stays local until you start the transmission.');
    });
  }

  async function playHls(video, channel) {
    video.src = `${hlsBase}/${encodeURIComponent(channel)}/index.m3u8`;
    await video.play().catch(() => {});
    setText('viewer-connection', 'HLS FALLBACK'); setText('viewer-status', 'Waiting for a source on this channel.');
  }

  async function initViewer() {
    const video = document.getElementById('viewer-video');
    const channel = new URLSearchParams(window.location.search).get('channel') || localStorage.getItem('signalRoomChannel') || 'live';
    setText('viewer-channel', channel); document.querySelector('.viewer-info h2').textContent = `Signal Room / ${channel}`;
    try {
      const peer = new RTCPeerConnection(); media.peer = peer;
      peer.addTransceiver('video', { direction: 'recvonly' }); peer.addTransceiver('audio', { direction: 'recvonly' });
      peer.ontrack = (event) => { video.srcObject = event.streams[0]; document.getElementById('viewer-empty').hidden = true; setText('viewer-connection', 'WEBRTC'); setText('viewer-status', ''); setText('viewer-count', '1'); };
      const offer = await peer.createOffer(); await peer.setLocalDescription(offer); await waitForIce(peer);
      const response = await fetch(`${whepBase}/${encodeURIComponent(channel)}/whep`, { method:'POST', headers:{'Content-Type':'application/sdp'}, body:peer.localDescription.sdp });
      if (!response.ok) throw new Error('WHEP unavailable');
      await peer.setRemoteDescription({ type:'answer', sdp:await response.text() });
    } catch (error) {
      media.peer?.close(); media.peer = null;
      await playHls(video, channel);
    }
  }

  return { initBroadcast, initViewer };
})();
