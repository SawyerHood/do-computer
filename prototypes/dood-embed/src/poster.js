/* The still pictures X shows before a Dood's page is played in a post: the app's own sky and
   creature, drawn once and photographed by posters.mjs. `poster({ color, seed, egg, title })`
   draws one into #app and sets `window.done` when it has settled. */
;(function () {
  var core = AgentOrbCore(THREE)
  var skies = AgentOrbSky(THREE)
  window.poster = function (o) {
    window.done = false
    var root = document.getElementById("app")
    root.innerHTML = '<canvas class="sky"></canvas><div class="egg"><canvas></canvas></div><h1></h1>'
    root.querySelector("h1").textContent = o.title || ""
    var eggBox = root.querySelector(".egg")
    var sky = skies.create(root.querySelector(".sky"), {})
    var orb = core.createOrb(eggBox.querySelector("canvas"), { seed: o.seed, color: o.color, size: 300, dark: true, notice: false })
    orb.setState(o.egg ? "egg" : "idle")
    sky.land()
    if (!o.egg) sky.dawn(3, true)
    var W = root.clientWidth, H = root.clientHeight, side = 0, sizedFor = 0, frames = 0
    sky.resize(W, H)
    function frame() {
      sky.clear(o.title ? H * 0.8 : null)
      sky.step(0.05)
      sky.render()
      var place = sky.egg(), stance = orb.stance()
      if (Math.abs(place.heading - sizedFor) > 0.004) {
        sizedFor = place.heading
        side = Math.round((place.heading * H) / stance.egg / skies.PIXEL) * skies.PIXEL
        eggBox.style.width = eggBox.style.height = side + "px"
        orb.resize(side)
      }
      orb.shadow = place.shadow
      eggBox.style.transformOrigin = "50% " + (stance.ground * 100).toFixed(2) + "%"
      eggBox.style.transform = "translate(" + Math.round(place.x - side / 2) + "px, " + Math.round(place.y - side * stance.ground) +
        "px) scale(" + (place.part / sizedFor).toFixed(4) + ")"
      if (++frames < 150) return requestAnimationFrame(frame)
      orb.paused = true
      window.done = true
    }
    requestAnimationFrame(frame)
  }
})()
