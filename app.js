require([
  "esri/Map",
  "esri/views/SceneView",
  "esri/layers/GraphicsLayer",
  "esri/Graphic",
  "esri/widgets/Home",
  "dojo/Deferred",
  "dojo/domReady!"
], function (Map, SceneView, GraphicsLayer, Graphic, Home, Deferred) {


  /* helpers */

  var pointAtZero = {
    type: "point",
    x: 0,
    y: 0,
    z: 0,
    spatialReference: {
      wkid: 3857
    }
  };

  var cupModels = {
    cone: {primitive: "cone"},
    gltfcup: {href: "./low-poly_plastic_cup/scene.gltf"}
  }

  var cupSymbol = {
    type: "point-3d",
    symbolLayers: [{
      type: "object",
      width: 700000,
      height: 1000000,
      resource: cupModels.gltfcup,
      anchor: "relative",
      anchorPosition: {x: 0, y: 0, z: -0.49}
    }]
  };

  var ballSymbol = {
    type: "point-3d",
    symbolLayers: [{
      type: "object",  // the visible small ball
      width: 150000,
      height: 150000,
      anchor: "bottom",
      resource: {
        primitive: "sphere"
      },
      material: {
        color: "#1c5a85"
      }
    }, {
      type: "object",  // the invisible hittest area
      width: 600000,  // slightly smaller than the visible cup
      height: 900000,
      resource: cupModels.gltfcup,
      anchor: "relative",
      anchorPosition: {x: 0, y: 0, z: -0.5},
      material: {
        color: [0, 0, 0, 0.01] //not hittestable if 0 opacity
      },
      castShadows: false
    }]
  };

  function createGraphic(xpos, symbol, attributes, color) {
    if(color) {
      symbol.symbolLayers[0].material = {color: color};
    }
    var pointGraphic = new Graphic({
      geometry: pointAtZero,
      symbol: symbol,
      attributes: attributes
    });
    pointGraphic.geometry.x = xpos;
    return pointGraphic;
  }

  var movePatterns = [
    [2, 0, -2],
    [1, -1, 0],
    [0, 1, -1]
  ];

  function loop(c, cb, loopsteps, dfd) {
    if (!dfd) {
      dfd = new Deferred();
    }
    if (c < loopsteps) {
      cb(c);
      c++;
      requestAnimationFrame(function (c, dfd) {
        loop(c, cb, loopsteps, dfd);
      }.bind(this, c, dfd));
    }
    else {
      dfd.resolve("done");
    }
    return dfd;
  }

  
  class Cup {
    constructor(xpos, id, withBall, color) {
      this.graphics = [];
      this.graphics.push(createGraphic(xpos, cupSymbol, {cup:id}, color));
      if (withBall) {
        this.graphics.push(createGraphic(xpos, ballSymbol, {ball:1}));
      }
    }
    move(xDelta, yDelta) {
      for (var g of this.graphics) {
        g.geometry.x += xDelta;
        if (yDelta) {
          g.geometry.y += yDelta;
        }
        g.geometry = g.geometry.clone();
      }
    }
    lift(zDelta, rotDelta) {
      for (var g of this.graphics) {
          if(g.attributes.cup !== undefined) {
          var sl = g.symbol.symbolLayers.getItemAt(0);
          sl.tilt += rotDelta;
          sl.anchorPosition.z += zDelta;
          g.symbol = g.symbol.clone();
        }
      }
    }
  }


  class HUD {
    constructor() {
      var hud = document.getElementById("hud");
      hud.classList.add("show");
      this.hud = hud;
      
      this.result = document.createElement("div");
      this.result.classList.add("result");
      hud.appendChild(this.result);

      this.level = document.createElement("div");
      this.level.classList.add("level", "show");
      hud.appendChild(this.level);

      const minLevel = document.createElement("div");
      minLevel.innerText = "🐢";
      minLevel.classList.add("minlevel");
      this.level.appendChild(minLevel);

      const maxLevel = document.createElement("div");
      maxLevel.innerText = "🏰";
      maxLevel.classList.add("maxlevel");
      this.level.appendChild(maxLevel);
      
      const bar = document.createElement("div");
      bar.classList.add("bar");
      this.level.appendChild(bar);
      
      this.currentLevel = document.createElement("div");
      this.currentLevel.classList.add("currentlevel");
      bar.appendChild(this.currentLevel);
      
      this.playButton = document.createElement("button");
      this.playButton.innerText = "Play";
      this.playButton.classList.add("play", "show");
      hud.appendChild(this.playButton);

      this.newGame = document.createElement("button");
      this.newGame.innerText = "New Game";
      this.newGame.classList.add("newgame");
      hud.appendChild(this.newGame);
    }

    reset() {
      this.hud.classList.add("show");
      this.newGame.classList.remove("show");
      this.playButton.innerText = "Play";
      this.result.classList.remove("show");
      this.playButton.classList.add("show");
      this.level.classList.add("show");
    }

    hide() {
      this.hud.classList.remove("show");
    }

    win() {
      this.result.textContent = "🏆 You win!";
      this.result.classList.add("show", "win");
      this.hud.classList.add("show");
    }

    princess() {
      this.result.textContent = "👸 Congrats! You rescued the princess."
      this.playButton.classList.remove("show");
      this.level.classList.remove("show");
      
    }

    lose () {
      this.result.textContent = "🙁 You lose!";
      this.result.classList.remove("win");
      this.result.classList.add("show");
      this.hud.classList.add("show");
      
    }

    playAgain() {
      this.playButton.textContent = "Go again";
      this.newGame.classList.add("show");
      this.hud.classList.add("show");
    }

    setLevel(level) {
      this.currentLevel.style.left = (level-1)*10 + "%"; //button is 10% wide
    }

  }

  class Game {
    constructor() {

      this.cupSpace = 1000000;
      this.cupMoveDistance = 40000;

      this.cups = []; //const order of cups
      this.cupsPos = []; //current position of cups, needed for shuffling
      this.graphicsLayer;

      this._initMap();

      this.hud = new HUD();
      this.hud.playButton.onclick = () => this.play();
      this.hud.newGame.onclick = () => this.newGame();
    }

    _initMap() {
      var map = new Map({
        basemap: "none"
      });

      map.ground.surfaceColor = "#e3eff6";
      
      this.view = new SceneView({
        container: "viewDiv",
        qualityProfile: "high",
        map: map
      });
      this.view.camera = {"position":{"spatialReference":{"wkid":4326},"x":6.974954223251486,"y":-38.17635387195816,"z":6884030.4981924575},"heading":2.6162381077601076,"tilt":22.82456313618229};
      this.view.environment.lighting.date = new Date(2018, 12, 24, 11, 33, 30, 0);
      this.view.environment.lighting.directShadowsEnabled = true;
      this.view.environment.lighting.ambientOcclusionEnabled = true;
      this.view.environment.lighting.cameraTrackingEnabled = false;

      this.view.ui.components = [];

      var homeWidget = new Home({
        view: this.view
      });
      this.view.ui.add(homeWidget, "top-left");
      
      var graphicsLayer = new GraphicsLayer();
      this.graphicsLayer = graphicsLayer;
      
      map.add(graphicsLayer);
      this.secret;

      this.view.when(function () {
      }.bind(this));
    }

    _handleClick(event) {
      this.view.hitTest(event)
        .then(function (response) {
          this.evalHits(response);
        }.bind(this));
    }

    newGame() {
      // cleanup
      this.graphicsLayer.removeAll();
      this.cups = [];
      this.firstLift = true;

      //reset level
      this.setLevel(3);  // 1 - 10;
      this.hud.reset();
      this.init();
    }

    setLevel(level) {
      level = Math.min(10, Math.max(1, level));
      this.level = level;
      this.loopsteps = Math.round(72/level/2)*2; //ensure 
      this.shuffleCnt = level;
      this.hud.setLevel(level);
      //console.log("level " + this.level, "shuffle " +this.shuffleCnt, "loopsteps " + this.loopsteps );
    }

    play() {
      this.hud.hide();
      this.liftAll(this.secret, this.firstLift ? undefined : "down")
      .then(this.shuffle.bind(this))
      .then(this.enableClick.bind(this));
    }

    evalHits(response) {
      if(response.results.length === 0) {
        //no cup clicked, give user another chance
        return; 
      }
      this.disableClick();
      var result = this._evalHits(response.results);
      this.liftAll(result.cupId, "up")
      .then(function(){
        if(result.hit) {
          this.hud.win();
          if(this.level === 10) {
            this.hud.princess();
          }
          this.setLevel(this.level + 1);
        } 
        else {
          this.hud.lose();
          this.setLevel(this.level - 1);
        }
        this.hud.playAgain();
      }.bind(this));
      
    }

    enableClick() {
      this.clickHandler = this.view.on("click", this._handleClick.bind(this));
      
    }
    disableClick() {
      if(this.clickHandler){
        this.clickHandler.remove();
      }
    }

    init() {
      // random choose cup with ball
      var ballId = Math.floor(Math.random() * 3);
      this.secret = ballId;

      // create cups
      var c0 = new Cup(0, 0, ballId === 0);
      this.graphicsLayer.addMany(c0.graphics);
      this.cups.push(c0);
      this.cupsPos[0] = c0;
      var c1 = new Cup(this.cupSpace, 1, ballId === 1);
      this.graphicsLayer.addMany(c1.graphics);
      this.cups.push(c1);
      this.cupsPos[1] = c1;
      var c2 = new Cup(this.cupSpace * 2, 2, ballId === 2);
      this.graphicsLayer.addMany(c2.graphics);
      this.cups.push(c2);
      this.cupsPos[2] = c2;
    }

    shuffle(cnt = 0) {
      var done = new Deferred();
      if (cnt++ > this.shuffleCnt) {
        done.resolve();
        return;
      }
      return this.singleShuffle()
        .then(this.shuffle.bind(this, cnt));
    }

    singleShuffle() {
      var movePattern = movePatterns[Math.floor(Math.random() * 3)];
      movePattern[3] = Math.sign(Math.random() - 0.5);
      this.cupsPos.sort(function (a, b) { //need to sort by x, movePattern relies on it
        return a.graphics[0].geometry.x > b.graphics[0].geometry.x ? 1 : -1;
      });
      var done = loop(0, function (step) {
        for (var i = 0; i < this.cups.length; i++) {
          this.cupsPos[i].move(this.cupMoveDistance * 25 / this.loopsteps * movePattern[i], Math.sin(step / this.loopsteps * Math.PI * 2) * this.cupMoveDistance * 40/this.loopsteps * movePattern[i] * movePattern[3]);
        }
      }.bind(this), this.loopsteps)
      return done;
    };

    liftAll(firstCup, upOrDown) {
      if(!upOrDown) {
        this.firstLift = false;
      }
      var order = firstCup === 1 ? [1,0,2] : ( firstCup === 2 ? [2,0,1]  : [0, 1, 2]);
      var done = new Deferred();
      this.liftOne(order[0], upOrDown);
      setTimeout(this.liftOne.bind(this, order[1], upOrDown), 100);
      setTimeout(function(done){
        this.liftOne(order[2], upOrDown).then(function(){done.resolve()})
      }.bind(this, done), 200);
      return done;
    }

    liftOne(cupId, upOrDown) {
      var stepsFactor = upOrDown !== undefined ? 2 : 1;
      var factor = upOrDown === "down" ? -1 : 1;

      var loopsteps = this.loopsteps * stepsFactor;

      var done = loop(0, function (step) {
        this.cups[cupId].lift(Math.sin(step / loopsteps * Math.PI * 2) * -3/loopsteps * factor, Math.sin(step / loopsteps * Math.PI * 2) * -200/loopsteps * factor);
      }.bind(this), this.loopsteps);
      return done;
    }

    _evalHits(hits) {
      if(hits.length === 0) {
        return {cupId: this.secret, hit: false}
      }
      else {
        var hitCupId = hits[0].graphic.attributes.cup;
        if(hits.length > 1 && hits[1].graphic && hits[1].graphic.attributes.ball) {
          // if second hit in ray is cup, we have a hit
          return {cupId: hitCupId, hit: true};
        }
        else {
          return {cupId: hitCupId, hit: false};
        }
      }
    }
  }

  var game = new Game();
  game.newGame();

});
