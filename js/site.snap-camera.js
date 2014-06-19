(function(exports) {

  var stokia = exports.stokia = {},
      po = org.polymaps;

  /*
   * Create a org.polymaps.map() instance with a configuration object and some
   * new methods:
   *
   * map.city("city-id")
     * set the focal city (with the named id in the config)
   * map.city({cityObj})
   *  set the focal city object by reference
   *
   * map.style("style-id")
   *  set the map style (with the named id in the config)
   * map.style({styleObj})
   *  set the map style object by reference
   *
   * map.controls("selector")
   *  configure interactivity controls in the element identified by CSS
   *  selector. This looks for any element with a data-action="action"
   *  attribute, and binds "click" event listeners on that element to
   *  associated action. Currently we support:
   *
   *  "zoom-in": zoom the map in by one level
   *  "zoom-out": zoom the map out by one level
   *
   * Configuration objects should have the following structure:
   *
   * {
   *   "map": {
   *     "zoom": 10,
   *     "zoomRange": [minZoom, maxZoom]
   *   },
   *   "cities": [
   *     {
   *       "id": "identifier",
   *       "center": [lat, lon],
   *       "bounds": [
   *         [north, west],
   *         [south, east]
   *       ],
   *       "styles": [
   *         "pinstripe",
   *         ...
   *       ]
   *     },
   *     ...
   *   ],
   *   "styles": {
   *     "id": {
   *       <style options>
   *     }
   *   }
   * }
   */
  stokia.map = function(config) {
    // map, style and city vars
    var map = po.map(),
        style, city,
        // cities list
        cities = config.cities,
        // cities lookup
        citiesById = stokia.util.unique(config.cities, "id"),
        // styles lookup
        stylesById = config.styles,
        // styles list
        styles = d3.entries(stylesById)
          .map(function(entry) {
            entry.value.id = entry.key;
            return entry.value;
          }),
        // controls
        controls,
        // bounding box shape
        bbox = po.geoJson()
          .on("show", po.stylist()
              .attr("fill", "#000")
              .attr("fill-opacity", .8)
              .attr("stroke", "#ff0")
              .attr("stroke-width", 2));

    map.config = config;

    var mc = config.map;
    if (mc.zoomRange instanceof Array) {
      map.zoomRange(mc.zoomRange);
      map.zoom(mc.zoomRange[0]);
    }
    if (!isNaN(mc.zoom)) {
      map.zoom(mc.zoom);
    }

    // dispatch "zoom" events when the zoom level changes
    var lastZoom;
    map.on("move", function() {
      if (controls) {
        var zoom = map.zoom();
        if (zoom != lastZoom) {
          map.dispatch({type: "zoom", zoom: zoom});
          lastZoom = zoom;
        }
      }
    });

    var __container__ = map.container;
    map.container = function(el) {
      if (arguments.length) {
        if (typeof el === "string") {
          el = stokia.coerce.element(el);
          if (el.nodeName !== "svg") {
            el = el.insertBefore(po.svg("svg"), el.firstChild);
          }
        }
        __container__.call(map, el);
        resize();
        return map;
      } else {
        return __container__();
      }
    };

    map.city = function(cityOrId) {
      if (arguments.length) {
        // you can provide either a city id or a city object
        if (typeof cityOrId === "object") {
          city = cityOrId;
        } else {
          city = citiesById[cityOrId];
        }

        // set the map's center to the city's
        if (city.center) {
          var center = stokia.coerce.latlong(city.center);
          map.center(center);
        }
        if (!isNaN(city.zoom)) {
          map.zoom(city.zoom);
        }

        // set the map's centerRange according to the city's bounds
        if (city.bounds) {
          var bounds = city.bounds.map(stokia.coerce.latlong);
          map.centerRange(bounds);

          bbox.features([{
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                btoring(city.bounds),
                btoring(bufferBounds(city.bounds, [10, 10]))
              ]
            }
          }]);
          map.add(bbox);
        } else {
          map.remove(bbox);
        }

        return map;
      } else {
        return city;
      }
    };

    var styleLayer;
    map.style = function(styleOrId) {
      if (arguments.length) {
        if (typeof styleOrId === "string") {
          style = stylesById[styleOrId];
        } else {
          style = styleOrId;
        }

        // style-specific zoom ranges
        if (style.zoomRange) {
          map.zoomRange(style.zoomRange);
        }

        if (styleLayer) {
          map.remove(styleLayer);
        }
        styleLayer = stokia.layer.fromStyle(style);
        if (styleLayer) {
          map.add(styleLayer);
          // re-add the bbox on top
          if (bbox && bbox.map() === map) {
            map.add(bbox);
          }
        } else {
          // XXX throw an exception?
        }
        return map;
      }
    };

    // control actions, e.g. <button data-action="zoom-in">
    var actions = {
      "zoom-in": function() { this.zoomBy(+1); },
      "zoom-out": function() { this.zoomBy(-1); }
    };

    // set the controls div
    map.controls = function(el) {

      controls = d3.select(stokia.coerce.element(el));

      controls.selectAll(".actions *[data-action]")
        .on("click", function(d) {
          var action = this.dataset.action;
          if (action in actions) {
            actions[action].call(map, d);
          } else {
            console.warn("no such action:", action, "for element:", this);
          }
        });

      // update zoom controls when the zoom level changes
      map.on("zoom", function(e) {
        var zoomRange = map.zoomRange();
        controls.selectAll("[data-action=zoom-out]")
          .attr("disabled", e.zoom <= zoomRange[0] ? "disabled" : null);
        controls.selectAll("[data-action=zoom-in]")
          .attr("disabled", e.zoom >= zoomRange[1] ? "disabled" : null);
      });

      return map;
    };

    // resize when the window resizes
    // (this assumes there is nothing under the map)
    function resize() {
      var container = map.container().parentNode,
          offsetTop = container.offsetTop;
      container.style.height = (window.innerHeight - offsetTop) + "px";
      map.resize();
    }

    function btoring(bounds) {
      var sw = bounds[0], ne = bounds[1],
          north = ne[1], south = sw[1],
          east = ne[0], west = sw[0];
      return [
        [west, north], [east, north],
        [east, south], [west, south],
        [west, north]
      ];
    }

    function bufferBounds(bounds, buffer) {
      var sw = bounds[0], ne = bounds[1],
          north = ne[1], south = sw[1],
          east = ne[0], west = sw[0],
          bx = buffer[0],
          by = buffer[1];
      return [[west - bx, south - by], [east + bx, north + by]];
    }

    // resize handler
    window.addEventListener("resize", resize);

    return map;
  };

  stokia.layer = {
    prefix: "",
    hosts: [],

    url: function(template) {
      if (typeof template === "object") {
        var url = template.url.replace("{prefix}", stokia.layer.prefix);
        return po.url(url)
          .hosts(template.hosts || []);
      } else {
        var url = template.replace("{prefix}", stokia.layer.prefix);
        return po.url(url)
          .hosts(stokia.layer.hosts);
      }
    }
  };

  stokia.layer.fromStyle = function(style) {
    switch (style.type) {

      case "2d":
        var url = stokia.layer.url(style.url);
        if (style.hosts) {
          url.hosts(style.hosts);
        }
        return po.image().url(url);

      case "3d":
        var layer = stokia.layer.threed()
          .wireframe(style.wireframe)
          .normalize(style.normalize)
          .heightColors(style.heightColors)
          .hsvColorScale(style.hsvColorScale);
        if (style.url) {
          var url = stokia.layer.url(style.url);
          if (style.hosts) {
            url.hosts(style.hosts);
          }
          layer.url(url);
        }

        if (style.texture) {
          var tex = stokia.layer.url(style.texture);
          if (style.hosts) {
            tex.hosts(style.hosts);
          }
          layer.texture(tex);
	}
        return layer;

      case "footprints":
        var layer = stokia.layer.footprints()
          .wireframe(style.wireframe || false);
        if (style.url) {
          var url = stokia.layer.url(style.url);
          if (style.hosts) {
            url.hosts(style.hosts);
          }
          layer.url(url);
        }
        return layer;

      default:
        console.warn("unrecognized style type:", style.type, style);
    }
    return null;
  };

  stokia.url = po.url;

  stokia.url.suffix = function(suffix) {
    var template;

    function format(tile, url, index) {
      if (template) {
        url = template(tile);
      }
      var bits = url.split("."),
          ext = bits.pop();
      bits[bits.length - 1] += "_" + index;
      bits.push(suffix);
      return bits.join(".");
    }

    format.template = function(x) {
      if (arguments.length) {
        template = (typeof x === "string")
          ? stokia.layer.url(x)
          : x;
        return url;
      }
    };

    return format;
  };


  stokia.layer.footprints = function() {
    var layer = po.layer(load, unload),
        map,
        tilesByKey = {},
        threedTiles = {},
        buildings = [], // list of building IDs to avoid re-rendering buildings split between continguous tiles
        tileSize = 254,
        camera = new THREE.PerspectiveCamera( 130, window.innerWidth / window.innerHeight, 1, 3000 ),
        // camera = new THREE.PerspectiveCamera( 100, 16/9, 1, 3000 ),
        scene = new THREE.Scene(),
        renderer = new THREE.WebGLRenderer({antialias : true}),
        ambientLight = new THREE.AmbientLight( 0xffffff ),
        // URL of JSON metadata per tile
        metaUrl = po.url(""),
        // URL of JPEG texture per tile URL
        textureUrl = stokia.url.suffix("jpg"),
        // URL of OBJ file per tile URL
        objUrl = stokia.url.suffix("obj"),
        normalize = false,
        wireframe = false,
        container = document.createElement("div");
    container.className = "threed";

    // set the scene
    camera.position = new THREE.Vector3( 0, 0, 400 );
    scene.add( ambientLight );

    var layerMap = layer.map;
    layer.map = function(_) {
      if (arguments.length) {
        // TODO: tear down
        map = _;
        layerMap.call(layer, map);
        if (map) {
          map.on("move", move)
            .on("resize", resize);

          var mapRoot = map.container(),
              mapParent = mapRoot.parentNode;
          mapParent.insertBefore(container, mapRoot);

          init();
          resize();
          move();
        }
        return layer;
      } else {
        return map;
      }
    };

    layer.url = function(url) {
      if (arguments.length) {
        metaUrl = (typeof url === "string")
          ? stokia.layer.url(url)
          : url;
        return layer;
      } else {
        return metaUrl;
      }
    };

    layer.wireframe = function(wf) {
      if (arguments.length) {
        wireframe = wf;
        return layer;
      } else {
        return wireframe;
      }
    };

    var completed = 0;
    po.queue.on("update", function(e) {
      completed++;
      map.dispatch({
        type: "loading", 
        active: e.active,
        queued: e.queued,
        complete: completed,
        percent: Math.round(completed / (e.active+e.queued+completed) * 100)
      });
      // console.log(threedTiles);
    });
    po.queue.on("complete", function(e) {
      map.dispatch({
        type: "complete"
      });
      completed = 0;
      map.dispatch({type: "move"});
    });

    function init() {
      // renderer.setClearColor(0xffffff);
      container.appendChild( renderer.domElement );
      requestAnimationFrame(animate);
    }

    function load(tile) {
      var element = tile.element = po.svg("g");
      tilesByKey[tile.key] = tile;

      var tileUrl = metaUrl(tile);
      if (tileUrl) {
        tile.request = po.queue.json(tileUrl, function(data) {
          tile.element.id = tile.key;

          var tileObject = new THREE.Object3D();  // store pieces of the 3d tile in here

          var size = map.size(),
              offset = {
                x: tile.x + size.x/2,
                y: tile.y + tileSize + size.y/2     // XXX why +tileSize? b/c camera.y = tileSize
              };

          for( var i = 0; i < data.features.length; i++ ) {
            var feature = data.features[i],
                buildingId = feature.properties.code;
                
                // console.log(buildingId);
                        
                if (buildings.indexOf(buildingId) !== -1) {
                  continue;
                }
                buildings.push(buildingId);

                // this gets the first piece of the building for lazy-debugging:
                var coords = feature.geometry.coordinates[0],
                    featurePoints = [];

                for( var j = 0 ; j < coords.length ; j ++ ) {
                    var point = mercator2screen(coords[j]),
                        px =  point.x - offset.x,
                        py =  point.y - offset.y;

                    featurePoints[j] = new THREE.Vector2( px, -py );
                }

                var buildingHeight = (feature.properties.maxheight - feature.properties.minheight) * 2;
                var shape = new THREE.Shape( featurePoints );
                var extrudeSettings = {
                  amount: buildingHeight, 
                  bevelEnabled: false 
                };

                try {
                    var geometry = new THREE.ExtrudeGeometry( shape, extrudeSettings );
                    geometry.colorsNeedUpdate = true;
                    // geometry.colors = colors;
                    // geometry.vertexColors = colors;

                    // // var buildingColor = ((buildingHeight/360) * (360-200) + 200)/360;
                    // // var buildingColor = (120 - (buildingHeight/305) * (120-0))/360;
                    var buildingColor = buildingHeight/(303*2);
                    // // var buildingColor = Math.random();
                    var color = new THREE.Color( 0xff0000 );
                    color.setHSV( buildingColor, 1, 1 );

                    var mesh = new THREE.Mesh( 
                        geometry, 
                        new THREE.MeshBasicMaterial( { 
                            vertexColors: true,//THREE.VertexColors, 
                            color: color,
                            transparent: true, 
                            opacity: 0.8,
                            antialias: true,
                            wireframe: wireframe
                            } )
                    );
                    mesh.position.z = feature.properties.minheight;
                    // // mesh.scale.set( 1.5, 1.5, 1 );
                    tileObject.add(mesh);

                } catch(e) {
                    // usually TypeError
                    console.log("encountered error", e);
                    continue;
                }

          }

          function mercator2screen(d) {
              d = map.locationPoint({ lon: d[0], lat: d[1] });
              return d;
          }

          threedTiles[tile.key] = tileObject;
          tileObject.position.x =  tile.translate[0];
          tileObject.position.y = -tile.translate[1] - tileSize.y;
          scene.add(tileObject);
          
        });
      }
    }

    function unload(tile) {
      // console.log("unload:", tile.key);
      if (tile.request) tile.request.abort(true);
      if (tile.loader) {
        // XXX cancel load here
      }

      delete tilesByKey[tile.key];
      var object = threedTiles[tile.key];

      if (object) {
        scene.remove(object);
        delete threedTiles[tile.key];
      }
    }

    function move() {
      var map = layer.map(), // in case the layer is removed
          mapZoom = map.zoom(),
          mapZoomFraction = mapZoom - (mapZoom = Math.round(mapZoom)),
          mapSize = map.size(),
          mapAngle = map.angle(),
          tileSize = map.tileSize(),
          tileCenter = map.locationCoordinate(map.center());

      buildings = [];

      var tiles = [];
      for (var key in tilesByKey) {
        if (tilesByKey[key].zoom === mapZoom) {
          tiles.push(tilesByKey[key]);
        } else if (threedTiles[key]) {
          //unload( tilesByKey[key] );
          threedTiles[key].visible = false;
          scene.remove(threedTiles[key]);
        } else {
          console.log("no obj for tile", key);
        }
      }

      var transform = {
        translate: [mapSize.x / 2, mapSize.y / 2],
        scale: Math.pow(2, mapZoomFraction)
      };

      tiles.forEach(function(tile) {
        var obj = threedTiles[tile.key];
        if (tile.element.parentNode) {
          if (obj) {
            obj.position.x =  tile.translate[0];
            obj.position.y = -tile.translate[1] - tileSize.y;

            if (!obj.visible) {
              obj.visible = true;
              scene.add(obj);
            }
          } else {
            // XXX reload tile?
          }
        } else {
          if (obj) {
            // XXX might go away
            scene.remove(obj);
            obj.visible = false;
          }
        }
      });

      camera.rotation.z = mapAngle;

      layer.dispatch({
        type: "transform",
        transform: transform,
        tiles: tiles
      });
    }

    // XXX anaglyph freeform
    var mouseX = 0, mouseY = 0;
    var windowHalfX = window.innerWidth / 2;
    var windowHalfY = window.innerHeight / 2;
    document.addEventListener( 'mousemove', onDocumentMouseMove, false );
    function onDocumentMouseMove( event ) {
      mouseX = (event.clientX - windowHalfX) / 2;
      mouseY = (event.clientY - windowHalfY) / 2;
    }
    // /freeform


    function animate() {
      render();
      requestAnimationFrame(animate);
    }

    function render() {
      camera.position.x += ( mouseX - camera.position.x ) * .01;
      camera.position.y += ( - mouseY*4 - camera.position.y ) * .01;
      camera.lookAt( scene.position );

      renderer.render( scene, camera );
    }

    function resize() {
      // map.dispatch({type: "move"});
      var size = map.size();
      camera.aspect = size.x / size.y;
      camera.updateProjectionMatrix();
      renderer.setSize( size.x, size.y );
    }

    return layer;
  };

  stokia.layer.threed = function() {
    var layer = po.layer(load, unload),
        map,
        tilesByKey = {},
        threedTiles = {},
        tileSize = 254,
        camera = new THREE.PerspectiveCamera( 130, window.innerWidth / window.innerHeight, 1, 3000 ),
        // camera = new THREE.PerspectiveCamera( 45, 16/9, 1, 3000 ),
        scene = new THREE.Scene(),
        renderer = new THREE.WebGLRenderer({antialias : true}),
        ambientLight = new THREE.AmbientLight( 0xffffff ),
        // URL of JSON metadata per tile
        metaUrl = po.url(""),
        // URL of JPEG texture per tile URL
        textureUrl = stokia.url.suffix("jpg"),
        // URL of OBJ file per tile URL
        objUrl = stokia.url.suffix("obj"),
        normalize = false,
        wireframe = false,
        heightColors = false,
        hsvColorScale = false,
        container = document.createElement("div"),
        anaglyphEffect;
    container.className = "threed";

    // set the scene
    // camera.position = new THREE.Vector3( 0, tileSize, 400 );
    camera.position = new THREE.Vector3( 0, 0, 800 );
    scene.add( ambientLight );

    var layerMap = layer.map;
    layer.map = function(_) {
      if (arguments.length) {
        // TODO: tear down
        map = _;
        layerMap.call(layer, map);

        map.tileSize({x: tileSize, y: tileSize});

        if (map) {
          map.on("move", move)
            .on("resize", resize);

          var mapRoot = map.container(),
              mapParent = mapRoot.parentNode;
          mapParent.insertBefore(container, mapRoot);

          init();
          resize();
          move();
        }
        return layer;
      } else {
        return map;
      }
    };


    layer.texture = function(url) {
      if (arguments.length) {
        textureUrl = (typeof url === "string")
          ? po.url(url)
          : url;
        return layer;
      } else {
        return textureUrl;
      }
    };

    layer.url = function(url) {
      if (arguments.length) {
        metaUrl = (typeof url === "string")
          ? po.url(url)
          : url;
        return layer;
      } else {
        return metaUrl;
      }
    };

    layer.normalize = function(wf) {
      if (arguments.length) {
        normalize = wf;
        return layer;
      } else {
        return normalize;
      }
    };

    layer.wireframe = function(wf) {
      if (arguments.length) {
        wireframe = wf;
        return layer;
      } else {
        return wireframe;
      }
    };

    layer.heightColors = function(hc) {
      if (arguments.length) {
        heightColors = hc;
        return layer;
      } else {
        return heightColors;
      }
    };

    layer.hsvColorScale = function(cs) {
      if (arguments.length) {
        hsvColorScale = cs;
        return layer;
      } else {
        return hsvColorScale;
      }
    };

    var completed = 0;
    po.queue.on("update", function(e) {
      completed++;
      map.dispatch({
        type: "loading", 
        active: e.active,
        queued: e.queued,
        complete: completed,
        percent: Math.round(completed / (e.active+e.queued+completed) * 100)
      });

      // console.log(threedTiles);
    });
    po.queue.on("complete", function(e) {
      map.dispatch({
        type: "complete"
      });
      completed = 0;
      map.dispatch({type: "move"});
    });

    function init() {
      // renderer.setClearColor(0xffffff);
      container.appendChild( renderer.domElement );
      requestAnimationFrame(animate);
    }

    function load(tile) {
      // console.log("load", tile.key);
      var element = tile.element = po.svg("g");
      tilesByKey[tile.key] = tile;

      var tileUrl = metaUrl(tile);
      if (tileUrl) {
        tile.request = po.queue.json(tileUrl, function(data) {
          tile.element.id = tile.key;

          var tileObject = new THREE.Object3D();  // store pieces of the 3d tile in here
          for (var i = 0 ; i < data.length; i++) {
            var obj = objUrl(tile, tileUrl, i),
                jpg = textureUrl(tile, tileUrl, i),
                textureKey = tile.key + "_" + i;
            // console.log("tile:", tile.key, obj, jpg, textureKey);

            // var texture = (map.textureUrl) ? THREE.ImageUtils.loadTexture(map.textureUrl) : THREE.ImageUtils.loadTexture(jpg);
            var texture = THREE.ImageUtils.loadTexture(jpg);
            tile.loader = loadTileModel(obj, texture, tile.key, textureKey, {
              wireframe: wireframe,
              antialias: true
            }, tileObject);

            tile.loader.addEventListener("load", function(e) {
              delete tile.loader;
            });
          }

          tileObject.id = tile.key;
          threedTiles[tile.key] = tileObject;
          scene.add(tileObject);
          tileObject.position.x =  tile.translate[0];
          tileObject.position.y = -tile.translate[1] - tileSize.y;
        });
      }
    }

    function unload(tile) {
      // console.log("unload:", tile.key);
      if (tile.request) tile.request.abort(true);
      if (tile.loader) {
        // XXX cancel load here
      }

      delete tilesByKey[tile.key];
      var object = threedTiles[tile.key];

      if (object) {
        // console.log("removing 3d object", tile.key);
        object.children.forEach(function(tilePiece) {
          scene.remove(tilePiece);
          tilePiece.material.dispose();
          tilePiece.geometry.dispose();
        });
        scene.remove(object);
        delete threedTiles[tile.key];
      }
    }

    function move() {
      var map = layer.map(), // in case the layer is removed
          mapZoom = map.zoom(),
          mapZoomFraction = mapZoom - (mapZoom = Math.round(mapZoom)),
          mapSize = map.size(),
          mapAngle = map.angle(),
          tileSize = map.tileSize(),
          tileCenter = map.locationCoordinate(map.center());

      var tiles = [];
      for (var key in tilesByKey) {
        if (tilesByKey[key].zoom === mapZoom) {
          tiles.push(tilesByKey[key]);
        } else if (threedTiles[key]) {
          //unload( tilesByKey[key] );
          threedTiles[key].visible = false;
          scene.remove(threedTiles[key]);
        } else {
          console.log("no obj for tile", key);
        }
      }

      var transform = {
        translate: [mapSize.x / 2, mapSize.y / 2],
        scale: Math.pow(2, mapZoomFraction)
      };

      tiles.forEach(function(tile) {
        var obj = threedTiles[tile.key];
        if (tile.element.parentNode) {
          if (obj) {
            obj.position.x =  tile.translate[0];
            obj.position.y = -tile.translate[1] - tileSize.y;

            if (!obj.visible) {
              obj.visible = true;
              scene.add(obj);
            }
          } else {
            // XXX reload tile?
            // console.log("polymaps tile w/out 3d partner", tile.key);
          }
        } else {
          if (obj) {
            // XXX might go away
            scene.remove(obj);
            obj.visible = false;
          }
        }
      });

      camera.rotation.z = mapAngle;

      layer.dispatch({
        type: "transform",
        transform: transform,
        tiles: tiles
      });
    }

    function loadTileModel( modelFile, texture, tileKey, textureKey, attrs, tileObject) {
      var loader = new THREE.OBJLoader();
      loader.addEventListener( 'load', function ( event ) {
        var object = event.content;
        for ( var i = 0, len = object.children.length; i < len; i ++ ) {
          
          var tilePiece = applyTexture( object.children[i], texture );

          for( var attrKey in attrs ) {
            // add other attributes to the material
            tilePiece.material[attrKey] = attrs[attrKey];
          }
          tilePiece.properties.textureKey = textureKey;
          tileObject.add(tilePiece);
        }
      });
      loader.load( modelFile );
      return loader;
    }

    function applyTexture( tilePiece, texture ) {
      
      if (!heightColors) {
        if (normalize) {
          tilePiece = calculateTextureNormals(tilePiece, texture);
        }
        tilePiece.material.antialias = true;
        tilePiece.material.map = texture;
        tilePiece.material.overdraw = true;
        // tilePiece.geometry.verticesNeedUpdate = true;
        // tilePiece.geometry.uvsNeedUpdate = true;
        // tilePiece.geometry.elementsNeedUpdate = true;
      } else {
        tilePiece.material.vertexColors = THREE.VertexColors;
        // tilePiece.geometry.vertices.forEach(function(vertex) {
        //   vertex.z = (vertex.z < 50) ? 0 : vertex.z;
        // });
        tilePiece.geometry.faces.forEach(function(face) {
          ['a', 'b', 'c'].forEach(function(side, j) {
            var height = tilePiece.geometry.vertices[face[side]].z;
            var color = new THREE.Color(0xff0000);
            var c = height / 200;   // XXX FIX ME: use d3 color scale with actual max/min building heights
            // c = ((360-200) * c + 200)/360;
            color.setHSV(c, c, c);
            face.vertexColors[j] = color;
          });
        });
      }

      return tilePiece;
    }

    function calculateTextureNormals(tilePiece) {
      // calculate the texture normals for a tile piece
      // note: Nokia should serve tiles as single objects instead of split up into pieces

        var faces = tilePiece.geometry.faces;
        
        var vMax = {x: -99999, y: -99999},
            vMin = {x: 99999, y: 99999};

        tilePiece.geometry.vertices.forEach(function(vertex) {
            vMax.x = Math.max(vertex.x, vMax.x);
            vMax.y = Math.max(vertex.y, vMax.y);
            vMin.x = Math.min(vertex.x, vMin.x);
            vMin.y = Math.min(vertex.y, vMin.y);
        });

        for ( var j = 0 ; j < tilePiece.geometry.faceVertexUvs[0].length ; j ++ ) {

          var face = faces [ j ];

          for ( var k = 0 ; k < tilePiece.geometry.faceVertexUvs[0][j].length ; k ++ ) {
              // k is 0,1,2

              var sides =  ['a', 'b', 'c', 'd'];
              var numSides = (face instanceof THREE.Face3) ? 3 : 4 ;

              tilePiece.geometry.faceVertexUvs[0][j] = [];

              for ( var s = 0 ; s < numSides ; s ++ ) {

                  var side = sides [ s ] ;
                  var vertexIndex = face [ side ] ;

                  var vertex = tilePiece.geometry.vertices[ vertexIndex ];
                  tilePiece.geometry.faceVertexUvs[0][j].push(
                    new THREE.Vector2 ( 
                      (vertex.x - vMin.x) / (vMax.x - vMin.x), 
                      (vertex.y - vMin.y) / (vMax.y - vMin.y) 
                    ) 
                  );
              }
          }
        }

      return tilePiece;
    }

    // XXX freeform puke-movement
    var mouseX = 0, mouseY = 0;
    var windowHalfX = window.innerWidth / 2;
    var windowHalfY = window.innerHeight / 2;
    document.addEventListener( 'mousemove', onDocumentMouseMove, false );
    function onDocumentMouseMove( event ) {
      mouseX = (event.clientX - windowHalfX) / 2;
      mouseY = (event.clientY - windowHalfY) / 2;
    }
    // /freeform
    // XXX anaglyph
    // anaglyphEffect = new THREE.AnaglyphEffect(renderer);
    // anaglyphEffect.setSize(window.innerWidth, window.innerHeight); 
    // /aanglyph


    function animate() {
      render();
      requestAnimationFrame(animate);
    }

    function render() {
      camera.position.x += ( mouseX - camera.position.x );
      camera.position.y += ( - mouseY - camera.position.y );
      camera.lookAt( scene.position );

      renderer.render( scene, camera );

      // anaglyphEffect.render(scene, camera);
    }

    function resize() {
      // map.dispatch({type: "move"});
      var size = map.size();
      camera.aspect = size.x / size.y;
      camera.updateProjectionMatrix();
      renderer.setSize( size.x, size.y );
    }

    return layer;
  };

  stokia.ui = {};

  stokia.ui.compass = function() {
    var compass = {},
        map,
        radius = 50,
        size = radius * 2 + 20,
        dragging = false,
        svg = d3.select(po.svg("svg"))
          .attr("width", size)
          .attr("height", size)
          .attr("class", "compass"),
        g = svg.append("g"),
        needle = g.append("g")
          .attr("class", "needle"),
        outer = g.append("g")
          .attr("class", "outer"),
        ring = outer.append("circle")
          .attr("class", "ring")
          .attr("fill", "transparent")
          .attr("stroke", "#fff")
          .attr("stroke-width", 14)
          .attr("r", radius),
        headings = outer.append("g")
          .attr("class", "headings")
          .selectAll("text")
            .data([
              {text: "N", angle: 0, radians: 0},
              {text: "E", angle: 90, radians: Math.PI / 2},
              {text: "S", angle: 180, radians: Math.PI},
              {text: "W", angle: 270, radians: Math.PI * (3/2)}
            ])
            .enter()
            .append("text")
              .text(function(d) { return d.text; })
              .attr("text-anchor", "middle")
              .attr("dy", ".5em")
              .style("font-weight", "bold")
              .attr("transform", function(d) {
                return [
                  "rotate(" + (d.angle - 90) + ")",
                  "translate(" + [radius + 1, 0] + ")",
                  "rotate(" + 90 + ")",
                ].join(" ");
              });
              // .on("click", function(d) {
              //   if(!dragging) {
              //     map.angle(d.radians + Math.PI);
              //   }
              // });

    svg.on("mousedown", mousedown);

    var lastAngle;
    function mousedown() {
      lastAngle = getMouseAngle();
      d3.select(document)
        .on("mousemove.compass", mousemove, true)
        .on("mouseup.compass", mouseup, true);
    }

    function mouseup() {
      dragging = false;
      d3.select(document)
        .on("mousemove.compass", null)
        .on("mouseup.compass", null);
    }

    function getMouseAngle() {
      var center = [size / 2, size / 2],
          mouse = d3.mouse(svg.node()),
          actualMouse = [mouse[0] - center[0], mouse[1] - center[1]],
          angle = Math.atan2(Math.round(actualMouse[1]), Math.round(actualMouse[0])),
          normalized = normalizeRadians(angle);

      return normalized;
    }

    var timeout;
    function mousemove() {
      dragging = true;
      var angle = getMouseAngle(),
          delta = angle - lastAngle;
      // console.log("delta:", rtod(delta).toFixed(2), "deg");
      lastAngle = angle;
      map.angle(map.angle() + delta); 
      // stokia.layer.camera.rotation.z += delta; // XXX MT

      d3.event.stopPropagation();
      d3.event.preventDefault();
      return false;
    }

    needle.append("circle")
      .attr("fill", "#fff")
      .attr("r", radius / 10);
    needle.append("path")
      .attr("fill", "#fff")
      .attr("d", [
        "M-2,0",
        "L2,0",
        "L0,-" + (radius - 2),
        "L-2,0Z"
      ].join(" "));

    compass.map = function(x) {
      if (arguments.length) {
        if (map) {
          map.off("move", move);
          map.off("resize", resize);
        }
        map = x;
        map.container()
          .parentNode
          .appendChild(svg.node());
        map.on("move", move);
        map.on("resize", resize);
        resize();
        return compass;
      }
    };

    function resize() {
      move();
    }

    var lastMoveAngle;
    function move() {
      var angle = map.angle();
      if (angle != lastMoveAngle) {
          var degrees = rtod(angle),
              inset = 20;
        // console.log("rotation:", angle.toFixed(2), "rad", degrees.toFixed(2), "deg");
        g.attr("transform", [
          "translate(" + [size/2, size/2] + ")",
          "rotate(" + degrees + ") "
        ].join(" "));
        lastMoveAngle = angle;
      }
    }

    return compass;
  };

  stokia.coerce = {
    element: function(el) {
      if (typeof el === "string") {
        return document.getElementById(el)
            || document.querySelector(el);
      }
      return el;
    },

    latlong: function(d) {
      if (d instanceof Array) {
        return {lat: d[1], lon: d[0]};
      } else {
        return d;
      }
    }
  };

  stokia.util = {};

  stokia.util.unique = function(list, key) {
    if (typeof key !== "function") {
      var k = key;
      key = function(o) { return o[k]; };
    }
    return d3.nest()
      .key(key)
      .rollup(function(subset) { return subset[0]; })
      .map(list);
  };

  /*
   * Query string parsing & formatting
   */
  stokia.query = {};

  // parse: "?foo=a&bar=b" -> {foo: "a", bar: "b"}
  stokia.query.parse = function(str) {
    if (str.charAt(0) === "?") str = str.substr(1);
    var parts = str.split("&"),
        len = parts.length,
        query = {};
    for (var i = 0; i < len; i++) {
      var bits = parts[i].split("=", 2),
          key = bits[0],
          val = (bits.length > 1)
            ? decodeURIComponent(bits[1])
            : true;
      switch (val) {
        case "true": val = true; break;
        case "false": val = false; break;
        default:
          var num = Number(val);
          if (!isNaN(num)) val = num;
          break;
      }
      query[key] = val;
    }
    return query;
  };

  // format: {foo: "a", bar: "b"} -> "?foo=a&bar=b"
  stokia.query.format = function(obj, sortKeys) {
    var entries = [];
    for (var key in obj) {
      if (key && obj.hasOwnProperty(key) && typeof obj[key] !== "undefined" && typeof obj[key] !== "function") {
        entries.push({key: key, value: obj[key]});
      }
    }
    if (sortKeys) {
      var sort = (typeof sortKeys === "function")
        ? sortKeys
        : function(a, b) {
            return (a.key > b.key) ? 1 : (a.key < b.key) ? -1 : 0;
          };
      keys.sort(sort);
    }
    return entries.map(function(entry) {
      return [entry.key, encodeURIComponent(entry.value)].join("=");
    }).join("&");
  };

  stokia.hash = function() {
    var lat = lat = 90 - 1e-8, // allowable latitude range
        s0; // = map.threejs.camera.position.z;

    function hashMove() {
      var s1 = formatter(map);
      if (s0 !== s1) location.replace(s0 = s1); // don't recenter the map!
    }

    // parsing and formatting the url hash (z/lon/lat/angle)
    function parser(map, urlHash) {
      var args = urlHash.split("/").map(Number);
      if ((args.length < 4 && map.angle() !== 0) || args.some(isNaN)) {
        // replace bogus hash
        hashMove();
      } else {
        map.angle(dtor(args[3]) || 0);
        var size = map.size();
        map.zoomBy(args[0] - map.zoom(),
            {x: size.x / 2, y: size.y / 2},
            {lat: Math.min(lat, Math.max(-lat, args[1])), lon: args[2]});
        map.dispatch({type: "move"});
      }
    }

    function formatter(map) {
      var center = map.center(),
          zoom = map.zoom(),
          precision = Math.max(0, Math.ceil(Math.log(zoom) / Math.LN2));
      var hash = "#" + [
        Math.round(zoom), 
        center.lat.toFixed(precision), 
        center.lon.toFixed(precision)
      ].join("/");
      if (map.angle() !== 0) hash += "/" + rtod(map.angle()).toFixed(2);
      return hash;
    };

    return po.hash()
      .parser(parser)
      .formatter(formatter);
  };

  stokia.compat = {};

  stokia.compat.check = function(sorry) {
    var canvas = document.createElement("canvas"),
        contexts = "webgl experimental-webgl moz-webgl webkit-3d".split(" "),
        gl;
    for (var i = 0; i < contexts.length; i++) {
      try {
        gl = canvas.getContext(contexts[i]);
      } catch (err) {
        continue;
      }
      if (gl) break;
    }
    if (gl) {
      return true;
    } else {
      if (sorry) alert(sorry);
      return false;
    }
  };

  function normalizeRadians(r) {
    var twoPi = 2 * Math.PI;
    if (r < 0) {
      while (r < 0) r += twoPi;
    } else {
      while (r > twoPi) r -= twoPi;
    }
    return r;
  }

  function rtod(r) {
    return (r / Math.PI * 180);
  }

  function dtor(d) {
    return (d / 180 * Math.PI);
  }

})(this);
