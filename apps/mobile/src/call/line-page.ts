/**
 * The page that carries the sound of a call. A phone's JavaScript has no WebRTC, and the
 * system's web view does: on a phone this page runs in a web view no one sees (`line-host.tsx`),
 * and in the browser build in a frame (`line-host.web.tsx`), so that both run this same page.
 * It holds the microphone, the line to the voice and the events beside it, and nothing else:
 * the call is placed by the app, which carries the session, and the page never sees the server.
 *
 * It is told, as `{ type, ... }` objects:
 *   open           take the microphone, and make an offer
 *   answer {sdp}   the voice's answer to that offer
 *   send {events}  events for the voice, each a string
 *   mute {muted}   stop sending the microphone, or start again
 *   close          let everything go
 * and it says:
 *   ready, offer {sdp}, answered, event {data}, levels {you, dood}, lost, failed {name, message}
 *
 * It is plain JavaScript in a string because that is what a web view is given. The browser
 * tests run it as it is.
 */
export const LINE_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body><script>
(function () {
  "use strict";
  var microphone = null, peer = null, channel = null, player = null, context = null;
  var meters = { you: null, dood: null };
  var waiting = [];
  var closed = false;
  var timer = null;

  function say(message) {
    var text = JSON.stringify(message);
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(text);
    else if (window.parent !== window) window.parent.postMessage(text, "*");
  }

  function meter(stream) {
    try {
      var Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return null;
      if (!context) context = new Context();
      if (context.state === "suspended") context.resume().catch(function () {});
      var analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      return analyser;
    } catch (error) {
      return null;
    }
  }
  var samples = new Uint8Array(512);
  function level(analyser) {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(samples);
    var sum = 0;
    for (var i = 0; i < samples.length; i++) {
      var value = (samples[i] - 128) / 128;
      sum += value * value;
    }
    return Math.min(1, Math.sqrt(sum / samples.length) * 3);
  }

  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    if (microphone) microphone.getTracks().forEach(function (track) { track.stop(); });
    if (player) player.srcObject = null;
    if (peer) peer.close();
    if (context) context.close().catch(function () {});
  }

  function failed(error) {
    close();
    say({
      type: "failed",
      name: (error && error.name) || "Error",
      message: (error && error.message) || "The call could not be started.",
    });
  }

  function open() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      // A page that is not on a secure address is given no microphone at all.
      return failed({ name: "NotAllowedError", message: "No microphone can be had here." });
    }
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then(function (stream) {
        if (closed) {
          stream.getTracks().forEach(function (track) { track.stop(); });
          return;
        }
        microphone = stream;
        peer = new RTCPeerConnection();
        player = document.createElement("audio");
        player.autoplay = true;
        player.setAttribute("playsinline", "");
        document.body.appendChild(player);
        stream.getTracks().forEach(function (track) { peer.addTrack(track, stream); });
        meters.you = meter(stream);
        peer.ontrack = function (event) {
          var heard = event.streams[0] || new MediaStream([event.track]);
          player.srcObject = heard;
          var playing = player.play();
          if (playing) playing.catch(function () {});
          meters.dood = meter(heard);
        };
        // The call does not connect without this channel, and the voice's events come over it.
        channel = peer.createDataChannel("oai-events");
        channel.onopen = function () {
          waiting.splice(0).forEach(function (event) { channel.send(event); });
        };
        channel.onmessage = function (event) {
          if (typeof event.data === "string") say({ type: "event", data: event.data });
        };
        peer.onconnectionstatechange = function () {
          if (!closed && (peer.connectionState === "failed" || peer.connectionState === "closed")) {
            say({ type: "lost" });
          }
        };
        return peer.createOffer().then(function (offer) {
          return peer.setLocalDescription(offer);
        }).then(function () {
          // The offer is sent whole, with every way of reaching this device in it.
          return new Promise(function (done) {
            if (peer.iceGatheringState === "complete") return done();
            var wait = setTimeout(done, 2500);
            peer.onicegatheringstatechange = function () {
              if (peer.iceGatheringState !== "complete") return;
              clearTimeout(wait);
              done();
            };
          });
        }).then(function () {
          if (closed) return;
          say({ type: "offer", sdp: (peer.localDescription && peer.localDescription.sdp) || "" });
          // How loud each of the two is, for the app to tell who is talking.
          timer = setInterval(function () {
            say({ type: "levels", you: level(meters.you), dood: level(meters.dood) });
          }, 70);
        });
      })
      .catch(failed);
  }

  function heard(message) {
    if (!message || typeof message.type !== "string") return;
    if (message.type === "open") return open();
    if (message.type === "close") return close();
    if (closed) return;
    if (message.type === "answer") {
      if (!peer) return;
      peer.setRemoteDescription({ type: "answer", sdp: message.sdp }).then(function () {
        say({ type: "answered" });
      }).catch(failed);
    } else if (message.type === "send") {
      (message.events || []).forEach(function (event) {
        if (channel && channel.readyState === "open") channel.send(event);
        else waiting.push(event);
      });
    } else if (message.type === "mute") {
      if (microphone) microphone.getAudioTracks().forEach(function (track) { track.enabled = !message.muted; });
    }
  }

  // A web view is told by a call to this; a frame by a message from the page around it.
  window.__line = heard;
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || typeof event.data !== "string") return;
    try { heard(JSON.parse(event.data)); } catch (error) {}
  });
  window.addEventListener("pagehide", close);
  say({ type: "ready" });
})();
</script></body></html>`
