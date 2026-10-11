/* A Dood hatched inside a post on X: a mock-up. The post, the composer, the phone and the browser
   window are pretend. The egg, the creature and the sky in the card are the app's own. */
;(function () {
  var core = AgentOrbCore(THREE)
  var skies = AgentOrbSky(THREE)
  var COLORS = [
    ["clay", "#b8674a"], ["moss", "#5f8a4e"], ["tide", "#3f7f9c"], ["plum", "#7d5a9a"],
    ["honey", "#c9952c"], ["slate", "#5b6672"], ["rose", "#c0607a"], ["ink", "#2f3a52"],
  ]
  var hexOf = function (id) { return COLORS.find(function (c) { return c[0] === id })[1] }
  var word = function (n) { return Math.random().toString(36).slice(2, 2 + n) }
  var wardrobe = AgentOrbWardrobe(THREE, core)
  var RARITY = { common: "#9aa3ad", uncommon: "#4fbf67", rare: "#4a9bff", epic: "#b266ff", legendary: "#ffb92e" }
  var ORDER = Object.keys(RARITY)
  // A few of the app's two hundred things, with the names and rarities it gives them.
  var THINGS = [
    ["party", "hat", "Party hat", "common"], ["beanie", "hat", "Beanie", "common"], ["sprout", "hat", "Sprout", "common"],
    ["round", "glasses", "Round glasses", "common"], ["shades", "glasses", "Shades", "common"], ["scarf", "neck", "Scarf", "common"],
    ["tophat", "hat", "Top hat", "uncommon"], ["cowboy", "hat", "Cowboy hat", "uncommon"], ["catears", "hat", "Cat ears", "uncommon"],
    ["cateye", "glasses", "Cat-eye glasses", "uncommon"], ["lei", "neck", "Lei", "uncommon"], ["carrot", "face", "Carrot nose", "uncommon"],
    ["wizard", "hat", "Wizard hat", "rare"], ["vr", "glasses", "Headset", "rare"], ["fairylights", "neck", "Fairy lights", "rare"],
    ["crown", "hat", "Crown", "epic"], ["halo", "hat", "Halo", "epic"], ["wings", "neck", "Little wings", "epic"],
    ["galaxy", "hat", "Pocket galaxy", "legendary"],
  ].map(function (t) { return { id: t[0], slot: t[1], name: t[2], rarity: t[3] } })
  var any = function (list) { return list[Math.floor(Math.random() * list.length)] }
  var of = function (rarity) { return any(THINGS.filter(function (t) { return t.rarity === rarity })) }
  // By the app's odds, near enough.
  var found = function () { var at = Math.random() * 100; return of(at < 60 ? "common" : at < 85 ? "uncommon" : at < 95 ? "rare" : at < 99 ? "epic" : "legendary") }
  var tiersTo = function (thing) { return ORDER.slice(0, ORDER.indexOf(thing.rarity) + 1).map(function (r) { return RARITY[r] }) }
  var wearing = function (thing, on) { var outfit = Object.assign({}, on); outfit[thing.slot] = thing.id; return outfit }

  // The Dood the scenes after the first are about. Hatching one in the first scene replaces it.
  var mine = { name: "Pip", color: "tide", seed: "pip-7kq2", id: "7kq2m9", outfit: { hat: "sprout" } }
  var live = []

  function h(tag, attrs) {
    var el = document.createElement(tag)
    for (var k in attrs || {}) {
      if (k === "html") el.innerHTML = attrs[k]
      else if (k === "text") el.textContent = attrs[k]
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k])
      else el.setAttribute(k, attrs[k])
    }
    for (var i = 2; i < arguments.length; i++) if (arguments[i]) el.append(arguments[i])
    return el
  }
  var esc = function (s) { return s.replace(/[&<>"]/g, function (c) { return "&#" + c.charCodeAt(0) + ";" }) }

  /* The card: what our page shows inside the post.
     mode "hatch"  an egg comes down and is hatched by whoever is looking
          "meet"   someone's Dood, to stroke and feed
          "claim"  the first run, going on from a Dood that is already out
          "owner"  the app, where what was given in the post is opened */
  function card(root, o) {
    var el = h("div", { class: "card" + (o.shape ? " " + o.shape : "") })
    var skyCanvas = h("canvas", { class: "sky" })
    var creature = h("canvas")
    var eggBox = h("div", { class: "egg" }, creature)
    var say = h("div", { class: "say", "data-on": "false" })
    var panel = h("div", { class: "panel", "data-on": "false", onclick: function (e) { e.stopPropagation() } })
    var skip = h("button", { class: "skip", text: "Skip", hidden: "" })
    var poster = h("div", { class: "poster" })
    el.append(skyCanvas, eggBox, h("div", { class: "mark", text: "do.computer" }), skip, say, panel, poster)
    root.append(el)

    var look = o.dood || { seed: word(8), color: "tide" }
    var out = o.mode !== "hatch"
    var sky = skies.create(skyCanvas, {})
    var orb = core.createOrb(creature, { seed: look.seed, color: hexOf(look.color), size: 300, dark: true, notice: false })
    orb.setState(out ? "idle" : "egg")
    if (out && look.outfit) wardrobe.dress(orb, look.outfit)
    var small = [], openIt = null
    if (!sky) { say.textContent = "This needs WebGL."; say.dataset.on = "true"; return { dispose: function () { orb.dispose() } } }
    sky.land()
    if (out) sky.dawn(3, true)

    var phase = "poster", taps = 0, gone = false
    var raf = 0, last = 0, side = 0, sizedFor = 0, w = 0, ht = 0, frames = 0, still = false

    function frame(now) {
      raf = requestAnimationFrame(frame)
      var seconds = Math.min(0.05, (now - last) / 1000 || 0)
      last = now
      var W = el.clientWidth, H = el.clientHeight
      if (!W || !H) return
      if (W !== w || H !== ht) { w = W; ht = H; sizedFor = 0; frames = 0; sky.resize(W, H) }
      // A picture, as X shows before the card is played: it is drawn until it has settled.
      if (still && frames > 90) { orb.paused = true; return }
      frames++
      sky.clear(panel.dataset.on === "true" ? panel.offsetTop : null)
      sky.step(still ? 0.05 : seconds)
      sky.render()
      var place = sky.egg(), stance = orb.stance()
      if (Math.abs(place.heading - sizedFor) > 0.004) {
        sizedFor = place.heading
        side = Math.max(60, Math.min(600, Math.round((place.heading * H) / stance.egg / skies.PIXEL) * skies.PIXEL))
        eggBox.style.width = eggBox.style.height = side + "px"
        orb.resize(side)
      }
      orb.shadow = place.shadow
      orb.turn = place.turn
      var top = Math.max(1 - side, Math.round(place.y - side * stance.ground))
      eggBox.style.transformOrigin = "50% " + (stance.ground * 100).toFixed(2) + "%"
      eggBox.style.transform = "translate(" + Math.round(place.x - side / 2) + "px, " + top + "px) rotate(" +
        place.lean.toFixed(2) + "deg) scale(" + (place.part / sizedFor).toFixed(4) + ")"
      eggBox.style.visibility = "visible"
    }
    raf = requestAnimationFrame(frame)

    function tell(line, small) {
      say.dataset.on = line ? "true" : "false"
      if (line) say.innerHTML = esc(line) + (small ? "<small>" + esc(small) + "</small>" : "")
    }
    function show() {
      panel.replaceChildren.apply(panel, arguments)
      panel.dataset.on = arguments.length ? "true" : "false"
    }
    var btn = function (cls, text, on) { return h("button", { class: "btn " + cls, text: text, onclick: on }) }

    function play() {
      poster.hidden = true
      still = false
      orb.paused = false
      if (o.mode === "meet") return meet()
      if (o.mode === "claim") return claim()
      if (o.mode === "owner") return owner()
      phase = "fall"
      tell("An egg is on its way down")
      skip.hidden = false
      sky.onLand = function () {
        skip.hidden = true
        orb.cheer()
        phase = "tap"
        tell("Tap the egg", "It hatches for whoever is here")
      }
      sky.fall()
    }

    function tap() {
      taps++
      orb.crack(taps === 1 ? 0.34 : 0.67)
      sky.chips(hexOf(look.color))
      sky.dawn(taps)
      sky.bump(0.5)
      if (taps === 1) return tell("Again")
      tell(null)
      phase = "name"
      naming()
    }

    function naming() {
      var input = h("input", { maxlength: "20", placeholder: "Name your Dood", autocomplete: "off", spellcheck: "false" })
      var go = btn("dark", "Hatch", hatch)
      go.disabled = true
      var keys = 0
      input.addEventListener("input", function () {
        go.disabled = !input.value.trim()
        if (++keys % 6 === 1) orb.pet(keys % 12 === 1 ? 1 : -1)
      })
      input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !go.disabled) hatch() })
      var dots = h("div", { class: "dots" })
      COLORS.forEach(function (c) {
        var dot = h("button", { class: "dot", style: "background:" + c[1], "aria-label": c[0], "aria-pressed": String(c[0] === look.color) })
        dot.onclick = function () {
          look.color = c[0]
          Array.prototype.forEach.call(dots.children, function (d) { d.setAttribute("aria-pressed", String(d === dot)) })
          orb.setColor(c[1])
          orb.pet(1)
          sky.glow(0.6)
        }
        dots.append(dot)
      })
      show(h("p", { class: "line", text: "What will you call it?" }), h("div", { class: "row" }, input, go), dots)
      function hatch() {
        mine = { name: input.value.trim(), color: look.color, seed: look.seed, id: word(6), outfit: {} }
        show()
        phase = "hatching"
        orb.hatch({ onOut: burst, onDone: born })
      }
    }

    function burst() {
      sky.flash(0.55)
      sky.dawn(3)
      sky.bump(0.9)
      sky.confetti(COLORS.map(function (c) { return c[1] }))
    }

    function born() {
      if (gone) return
      out = true
      orb.notice = true
      phase = "out"
      show(
        h("p", { class: "line", text: mine.name + " is out." }),
        h("p", { class: "sub", text: "Not the one? Another egg has a different Dood in it, with the same name and colour." }),
        h("div", { class: "row" }, btn("light grow", "Hatch another", again), btn("dark grow", "Keep " + mine.name, present)),
      )
    }

    // Another one: the same name and colour, and whatever the new egg holds.
    function again() {
      show()
      phase = "hatching"
      orb.notice = false
      mine.seed = look.seed = word(8)
      sky.flash(0.35)
      sky.bump(0.7)
      orb.setSeed(look.seed)
      orb.setColor(hexOf(look.color))
      orb.setState("egg")
      orb.crack(0.67)
      sizedFor = 0
      setTimeout(function () { if (!gone) sky.chips(hexOf(look.color)) }, 350)
      setTimeout(function () { if (!gone) orb.hatch({ onOut: burst, onDone: born }) }, 1000)
    }

    // What it came with: a box of the app's, with three things in it and one to keep.
    function present() {
      phase = "gift"
      var three = [of("common"), of("uncommon"), of(Math.random() < 0.7 ? "rare" : "epic")]
      var gift = wardrobe.unwrap(orb, {
        onPop: function () { sky.flash(0.4); sky.bump(0.6) },
        onShown: function () { setTimeout(function () { if (!gone) choose() }, 700) },
      })
      openIt = function () {
        openIt = null
        show()
        gift.shake()
        setTimeout(function () { if (!gone) gift.open({ id: three[2].id, tiers: tiersTo(three[2]) }) }, 800)
      }
      show(
        h("p", { class: "line", text: mine.name + " came with a present." }),
        h("p", { class: "sub", text: "Three things are inside. One is " + mine.name + "'s to keep." }),
        h("div", { class: "row" }, btn("dark grow", "Open it", function () { openIt && openIt() })),
      )
      function choose() {
        gift.dispose()
        phase = "out"
        var picked = null
        var keep = btn("dark grow", "Pick one", function () {
          mine.outfit = wearing(picked, {})
          small.splice(0).forEach(function (one) { one.dispose() })
          ready()
        })
        keep.disabled = true
        var tiles = h("div", { class: "tiles" })
        three.forEach(function (thing) {
          var canvas = h("canvas")
          var tile = h("button", { class: "tile", "aria-pressed": "false" }, canvas,
            h("b", { text: thing.name }), h("i", { text: thing.rarity, style: "color:" + RARITY[thing.rarity] }))
          tile.onclick = function () {
            picked = thing
            Array.prototype.forEach.call(tiles.children, function (t) { t.setAttribute("aria-pressed", String(t === tile)) })
            wardrobe.dress(orb, wearing(thing, {}))
            orb.cheer()
            sky.glow(0.6)
            keep.disabled = false
            keep.textContent = "Keep the " + thing.name.toLowerCase()
          }
          tiles.append(tile)
          var one = core.createOrb(canvas, { seed: look.seed, color: hexOf(look.color), size: 72, dark: false, notice: false, slow: true })
          wardrobe.dress(one, wearing(thing, {}))
          small.push(one)
        })
        show(h("p", { class: "line", text: "Which one is " + mine.name + "'s?" }), tiles, h("div", { class: "row" }, keep))
      }
    }

    function ready() {
      show(
        h("p", { class: "line", text: mine.name + " is ready." }),
        h("p", { class: "sub", text: "Show it to everyone, or keep it. Once it is claimed, the treats people give it in the post fill presents for you." }),
        h("div", { class: "row" },
          btn("light grow", "Share " + mine.name, function () { location.hash = "share" }),
          btn("dark grow", "Claim " + mine.name, function () { location.hash = "claim" })),
      )
    }

    function meet() {
      phase = "out"
      orb.notice = true
      var pats = 412, treats = 96, stroke = 0
      var count = h("span", { class: "count" })
      var tally = function () { count.textContent = pats + " pats · " + treats + " treats" }
      tally()
      el.addEventListener("pointermove", function (e) {
        var box = eggBox.getBoundingClientRect()
        var x = ((e.clientX - box.left) / box.width) * 2 - 1
        if (Math.abs(x) > 0.7 || e.clientY < box.top + box.height * 0.2 || e.clientY > box.bottom) return
        orb.pet(x, 0.08)
        if ((stroke += 0.08) >= 1) { stroke = 0; pats++; tally() }
      })
      // Four treats fill a present, as in the app. Here they are anyone's who opens the post.
      var filled = 3
      var pips = h("div", { class: "pips" })
      var toward = h("span")
      var meter = h("div", { class: "meter" }, pips, toward)
      var fill = function () {
        pips.replaceChildren()
        for (var n = 0; n < 4; n++) pips.append(h("i", { "data-on": String(n < filled) }))
        toward.textContent = filled === 4 ? "That makes a present for " + look.name + "'s owner" : filled + " of 4 treats to its next present"
        meter.dataset.full = String(filled === 4)
      }
      fill()
      var feed = btn("light grow", "Give a treat", function () {
        feed.disabled = true
        orb.offer(true)
        setTimeout(function () { orb.bite() }, 650)
        setTimeout(function () { orb.bite() }, 1050)
        setTimeout(function () {
          orb.offer(false)
          orb.cheer()
          treats++
          tally()
          filled++
          fill()
          feed.textContent = "Given for today"
          if (filled === 4) sky.confetti([hexOf(look.color), "#ffb92e"])
        }, 1500)
      })
      show(
        h("div", { class: "row", style: "margin-top:0" }, h("p", { class: "line", text: look.name }), count),
        meter,
        h("div", { class: "row" }, feed, btn("dark grow", "Hatch your own", function () {
          dispose()
          card(root, { mode: "hatch", shape: o.shape, auto: true })
        })),
      )
    }

    // In the app, as its owner: what the post's treats came to, opened with the app's own box.
    function owner() {
      phase = "out"
      orb.notice = true
      var left = 3
      var waiting = function (line, sub) {
        show(
          h("p", { class: "line", text: line }),
          h("p", { class: "sub", text: sub }),
          left ? h("div", { class: "row" }, btn("dark grow", left === 3 ? "Open one" : "Open another", open)) : null,
        )
      }
      function open() {
        var thing = found()
        show()
        phase = "gift"
        var gift = wardrobe.unwrap(orb, {
          onPop: function () { sky.flash(0.4); sky.bump(0.6) },
          onShown: function () {
            setTimeout(function () {
              if (gone) return
              gift.dispose()
              phase = "out"
              look.outfit = wearing(thing, look.outfit)
              wardrobe.dress(orb, look.outfit)
              orb.cheer()
              left--
              waiting(thing.name + ".", thing.rarity[0].toUpperCase() + thing.rarity.slice(1) + ", and on. " +
                (left ? left + (left === 1 ? " present" : " presents") + " left." : "That was the last one, until the next four treats."))
            }, 1300)
          },
        })
        gift.shake()
        setTimeout(function () { if (!gone) gift.open({ id: thing.id, tiers: tiersTo(thing) }) }, 800)
      }
      waiting("12 treats came in from your post.", "Four treats fill a present, so that is 3. Each holds one thing to wear, as a present in the app does today.")
    }

    function claim() {
      phase = "out"
      orb.notice = true
      orb.setState("speaking")
      var done = function () {
        orb.setState("idle")
        orb.cheer()
        sky.confetti([hexOf(look.color)])
        show(
          h("p", { class: "line", text: look.name + " is yours." }),
          h("p", { class: "sub", text: "From here it is the app: " + look.name + "'s chat, with its hello first. Treats given in the post now fill presents for you." }),
        )
      }
      show(
        h("p", { class: "line", text: "I'm " + look.name + ". I hatched in a post on X." }),
        h("p", { class: "sub", text: "Sign in and I'm yours. I get a computer of my own and start working for you." }),
        h("div", { class: "row" }, btn("dark grow", "Continue with GitHub", done), btn("light grow", "Use email", done)),
      )
    }

    el.addEventListener("click", function () {
      if (phase === "fall" && sky.falling) sky.land()
      else if (phase === "tap") tap()
      else if (phase === "gift") openIt && openIt()
      else if (phase === "out") orb.cheer()
    })
    skip.onclick = function (e) { e.stopPropagation(); sky.land() }
    poster.onclick = function (e) { e.stopPropagation(); o.onPoster ? o.onPoster() : play() }

    if (o.auto) play()
    else {
      still = true
      var title = o.mode === "hatch" ? ["Hatch a Dood", "Right here, in this post"] : ["Meet " + look.name, "A Dood, hatched in a post"]
      poster.append(h("h2", { html: esc(title[0]) + "<small>" + esc(title[1]) + "</small>" }))
      if (o.play !== false) poster.append(h("div", { class: "play" }))
    }

    function dispose() {
      if (gone) return
      gone = true
      cancelAnimationFrame(raf)
      small.forEach(function (one) { one.dispose() })
      orb.dispose()
      sky.dispose()
      el.remove()
    }
    var it = { dispose: dispose }
    live.push(it)
    return it
  }

  /* The post around it. */
  function face(seed, color) {
    var canvas = h("canvas")
    var orb = core.createOrb(canvas, { seed: seed, color: hexOf(color), size: 40, dark: true, notice: false, slow: true })
    live.push(orb)
    return h("div", { class: "x-face" }, canvas)
  }
  var who = function (name, at, seed, color) {
    return h("div", { class: "x-who" }, face(seed, color),
      h("div", {}, h("div", { class: "x-name", text: name }), h("div", { class: "x-at", text: "@" + at })))
  }
  function post(o) {
    var body = h("div")
    var el = h("div", { class: "x-post" },
      who(o.name, o.at, o.seed, o.color),
      h("div", { class: "x-text", html: o.text }),
      body,
      h("p", { class: "x-from", text: "From do.computer" }),
      h("div", { class: "x-meta", html: "9:41 AM · Oct 12, 2026 · <b>" + o.views + "</b> Views" }),
      h("div", { class: "x-acts", html: "<span><b>" + o.counts[0] + "</b> Replies</span><span><b>" + o.counts[1] + "</b> Reposts</span><span><b>" + o.counts[2] + "</b> Likes</span>" }),
    )
    return { el: el, body: body }
  }
  var reply = function (name, at, seed, color, text) {
    return h("div", { class: "x-reply" }, face(seed, color),
      h("div", {}, h("span", { class: "x-name", text: name }), h("span", { class: "x-at", text: " @" + at + " · 2m" }), h("p", { html: text })))
  }
  var column = function () {
    var col = h("div", { class: "x-col" }, h("div", { class: "x-head", html: "<span>←</span><span>Post</span>" }))
    for (var i = 0; i < arguments.length; i++) col.append(arguments[i])
    return col
  }
  var link = function () { return '<span class="x-link">do.computer/d/' + mine.id + "</span>" }
  var ours = function () {
    return post({ name: "Do Computer", at: "docomputer", seed: "do-computer", color: "tide", text: "Hatch a Dood.\nRight here, in this post. 🥚", views: "88.4K", counts: ["48", "212", "1.9K"] })
  }
  var theirs = function () {
    return post({ name: "Ada", at: "ada_builds", seed: "ada", color: "rose", text: "I hatched " + esc(mine.name) + " 🥚\n\nHatch yours: " + link(), views: "3,104", counts: ["7", "12", "86"] })
  }
  var replies = function () {
    return [
      reply("Ada", "ada_builds", "ada", "rose", "mine is called Pip and it is perfect " + link()),
      reply("Tomás", "tomasr", "tomas", "honey", "ok I named mine Gerald"),
    ]
  }

  var SCENES = {
    hatch: {
      label: "1 · Hatch in the post",
      note: "Our own post. Before it is played X shows our picture and its play button; then the card is our page, 480 by 480, shown at the post's width. An egg comes down, two taps crack it, it is named and given a colour, and it hatches. \"Hatch another\" gives a different Dood as often as wanted. Then its present: the app's box, with three things in it and one to keep. Nobody signs in. The two buttons at the end go to scenes 2 and 4.",
      draw: function (app) {
        var p = ours()
        card(p.body, { mode: "hatch" })
        app.append(column.apply(null, [p.el].concat(replies())))
      },
    },
    share: {
      label: "2 · Share it",
      note: "\"Share\" opens X's own composer in a new tab with the words and the Dood's link filled in. The link is a page of ours for that one Dood, so the post it makes carries that Dood as its card. \"Post\" goes to scene 3.",
      draw: function (app) {
        var p = ours()
        card(p.body, { mode: "meet", dood: mine, play: false, onPoster: function () {} })
        app.append(column(p.el))
        var preview = h("div")
        var box = h("div", { class: "x-compose" },
          who("You", "you", "you", "moss"),
          h("div", { class: "x-text", html: "I hatched " + esc(mine.name) + " 🥚\n\nHatch yours: " + link() }),
          preview,
          h("div", { class: "bar" }, h("span", { text: "Everyone can reply" }), h("button", { class: "x-go", text: "Post", onclick: function () { location.hash = "shared" } })),
        )
        app.append(h("div", { class: "x-dim" }, box))
        card(preview, { mode: "meet", dood: mine, onPoster: function () {} })
      },
    },
    shared: {
      label: "3 · Someone's Dood",
      note: "What their followers see, of a Dood that has been claimed. Played, it is that Dood on its island in what it wears: it looks at the pointer and can be stroked and fed. Every fourth treat, whoever gives it, is a present for its owner (scene 5). One treat a day from each person. \"Hatch your own\" starts scene 1 in the same card.",
      draw: function (app) {
        var p = theirs()
        card(p.body, { mode: "meet", dood: mine })
        app.append(column(p.el, reply("Tomás", "tomasr", "tomas", "honey", "gave it a treat. it did a little hop")))
      },
    },
    claim: {
      label: "4 · Claim it",
      note: "\"Claim\" opens do.computer in a new tab with the Dood's id in the address (a card in a post cannot share a sign-in with the site). It is the first run without the fall and the name: the Dood is already out and asks only who you are. Signing in makes it the account's first agent, same look and name.",
      draw: function (app) {
        var body = h("div", { class: "body" })
        app.append(h("div", { class: "win" },
          h("div", { class: "bar" }, h("i"), h("i"), h("i"), h("span", { text: "do.computer/welcome?dood=" + mine.id })), body))
        card(body, { mode: "claim", dood: mine, shape: "fill", auto: true })
      },
    },
    presents: {
      label: "5 · Presents from treats",
      note: "The owner, in the app. The treats given in the post have filled presents, and they are opened with the box the app already has: one thing each, by its rarities, and worn from then on, in the post as well.",
      draw: function (app) {
        var body = h("div", { class: "body" })
        app.append(h("div", { class: "win" },
          h("div", { class: "bar" }, h("i"), h("i"), h("i"), h("span", { text: "do.computer" })), body))
        card(body, { mode: "owner", dood: mine, shape: "fill", auto: true })
      },
    },
    phone: {
      label: "6 · In the X app",
      note: "The phone apps do not play a card in the timeline. They show the picture with a play button, and a tap opens our page in X's own browser over the post, where it is the same card at full height. Tap the picture.",
      draw: function (app) {
        var p = theirs()
        var body = h("div", { class: "body" })
        var sheet = h("div", { class: "sheet", "data-on": "false" },
          h("div", { class: "bar" }, h("b", { text: "Done", onclick: function () { location.hash = "phone"; draw() } }), h("span", { text: "do.computer/d/" + mine.id })), body)
        card(p.body, { mode: "meet", dood: mine, onPoster: function () {
          sheet.dataset.on = "true"
          card(body, { mode: "meet", dood: mine, shape: "fill", auto: true })
        } })
        app.append(h("div", { class: "phone" }, column(p.el), sheet))
      },
    },
    off: {
      label: "7 · If X turns cards off",
      note: "X stopped playing cards in posts for some hours on 8 October, Tweetcraft's included, and may again. The same link then shows as an ordinary picture card, and a click opens the Dood's page in a tab. Nothing else changes. Click the picture.",
      draw: function (app, opened) {
        if (opened) {
          var body = h("div", { class: "body" })
          app.append(h("div", { class: "win" },
            h("div", { class: "bar" }, h("i"), h("i"), h("i"), h("span", { text: "do.computer/d/" + mine.id })), body))
          return void card(body, { mode: "meet", dood: mine, shape: "fill", auto: true })
        }
        var p = theirs()
        card(p.body, { mode: "meet", dood: mine, shape: "wide", play: false, onPoster: function () { draw(true) } })
        app.append(column(p.el))
      },
    },
  }

  var app = document.getElementById("app"), strip = document.getElementById("strip")
  function draw(opened) {
    var name = location.hash.slice(1)
    if (!SCENES[name]) name = "hatch"
    live.splice(0).forEach(function (it) { it.dispose() })
    app.replaceChildren()
    SCENES[name].draw(app, opened === true)
    var nav = h("nav", {}, h("b", { text: "Mock-up" }))
    Object.keys(SCENES).forEach(function (key) {
      nav.append(h("button", { text: SCENES[key].label, "aria-current": String(key === name), onclick: function () {
        if (location.hash === "#" + key) draw()
        else location.hash = key
      } }))
    })
    strip.replaceChildren(nav, h("p", { text: SCENES[name].note }))
    scrollTo(0, 0)
  }
  addEventListener("hashchange", draw)
  draw()
})()
