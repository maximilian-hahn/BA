import './style.css';
import * as THREE from 'three';
import * as Math from 'mathjs';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils';
import { GUI } from 'dat.gui/build/dat.gui.module.js';
import * as hdf5 from 'jsfive';


let canvas, renderer, camera, controls, scene, gui, vertex_folder, raycaster;
let axes_scene;
let model, model_vertices;
let reset_orig_flag = false;
let marked_vertex, marked_vertex_index;
let mouse_down = false;

// gui attributes
let point_scale = 10;
let variance_scale = 0;
let variance_changed = false;
let pca_index = 0;
let vertex_change = new THREE.Vector3(0, 0, 0);

init();
animate();

function init() {
  // init rendering
  canvas = document.querySelector('#c');
  renderer = new THREE.WebGLRenderer({canvas});
  renderer.autoClear = false;

  camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 100000);
  camera.position.set(0, 0, 150);
  console.log(camera);

  controls = new OrbitControls(camera, canvas);
  // controls.maxDistance = 1;
  // controls.minDistance = 0.1;
  controls.update();

  scene = new THREE.Scene();
  scene.background = new THREE.Color('black');

  raycaster = new THREE.Raycaster();

  axes_scene = new THREE.Scene();
  const axes_helper = new THREE.AxesHelper(500);
  axes_scene.add(axes_helper);

  // gui stuff
  {
    gui = new GUI();
    gui.addColor({color: '#000000'}, 'color')
      .name('model color')
      .onChange(function(e) {
        model.material.color = new THREE.Color(e);
    });
    gui.add({show_vertices: function() {
      let points = scene.getObjectByName("points");
      points.visible = !points.visible;
    }}, "show_vertices").name("show/hide vertices");
    gui.add({show_template: function() {
      model.visible = false;
      model_vertices.visible = false;
      if (model.name == "template_model") {
        model = scene.getObjectByName("model");
        model_vertices = scene.getObjectByName("points");
      } else if (model.name == "model") {
        model = scene.getObjectByName("template_model");
        model_vertices = scene.getObjectByName("template_points");
      }
      model.visible = true;
      model_vertices.visible = true;
    }}, "show_template").name("switch between template and model");
    gui.add({point_scale}, "point_scale", 0.1, 100, 0.05).name("point scale").onChange(value => point_scale = value);

    let variance_folder = gui.addFolder("pca variance");
    let controller_variance_scale = variance_folder.add({variance_scale}, "variance_scale", -0.1, 0.1, 0.001).name("variance scale")
      .onChange(value => {
        variance_scale = value;
        variance_changed = true;
      });
    variance_folder.add({pca_index}, "pca_index", 0, 20, 1).name("pca index")
      .onChange(value => {
        pca_index = value;
        controller_variance_scale.setValue(Math.subset(model.userData.z, Math.index(value)));
      });
    variance_folder.add({reset_variance_scale: function() {
      model.userData.z = Math.zeros(Math.size(model.userData.z));
      variance_scale = 0;
      pca_index = 0;
      variance_folder.__controllers.forEach(controller => controller.setValue(controller.initialValue));
      variance_changed = true;
    }}, "reset_variance_scale").name("reset variance scale");

    vertex_folder = gui.addFolder("change vertex position");
    vertex_folder.add(vertex_change, "x", -50, 50, 0.5).name("change vertex x")
      .onChange(value => vertex_change.x = value);
    vertex_folder.add(vertex_change, "y", -50, 50, 0.5).name("change vertex y")
      .onChange(value => vertex_change.y = value);
    vertex_folder.add(vertex_change, "z", -50, 50, 0.5).name("change vertex z")
      .onChange(value => vertex_change.z = value);
    vertex_folder.add({reset_orig: function() {
      reset_vertex_gui();
      reset_orig_flag = true;
    }}, "reset_orig").name("reset to original position");
    vertex_folder.add({reset_all: function() {
      const current_pos = model.geometry.getAttribute('position');
      const orig_pos = model.geometry.getAttribute('original_position');
      for (let i = 0; i < current_pos.array.length; i++) {
        current_pos.setXYZ(i, orig_pos.getX(i), orig_pos.getY(i), orig_pos.getZ(i));
      }
      current_pos.needsUpdate = true;
      model.geometry.computeBoundingSphere();
    }}, "reset_all").name("reset all vertices");
  }


  // hemisphere light
  {
    const skyColor = 0xB1E1FF;  // light blue
    const groundColor = 0xB97A20;  // brownish orange
    const intensity = 1;
    const light = new THREE.HemisphereLight(skyColor, groundColor, intensity);
    scene.add(light);
  }  

  // directional light
  {
    const light = new THREE.DirectionalLight(0xFFFFFF, 1);
    light.position.set(-10, 2, 0);
    scene.add(light);
  }

  // ambient light
  {
    scene.add(new THREE.AmbientLight(0x404040));
  }
  

  // plane for reference of space
  /*{
    const planeSize = 40;

    const loader = new THREE.TextureLoader();
    const texture = loader.load('../models/checker.png');
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    const repeats = planeSize / 2;
    texture.repeat.set(repeats, repeats);

    const planeGeo = new THREE.PlaneBufferGeometry(planeSize, planeSize);
    const planeMat = new THREE.MeshPhongMaterial({
      map: texture,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(planeGeo, planeMat);
    mesh.rotation.x = Math.PI * -.5;
    scene.add(mesh);
  }*/

  // testing cube
  /*{
    const cube = new THREE.Mesh(new BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({color: 0x00ff00}));

    cube.geometry.deleteAttribute('uv');  // TODO: uv and normals broken after this
    cube.geometry.deleteAttribute('normal');

    cube.geometry = BufferGeometryUtils.mergeVertices(cube.geometry);
    cube.geometry.computeVertexNormals();
    
    const position = cube.geometry.getAttribute('position');
    cube.geometry.attributes.original_position = position.clone();
    model = cube;
    console.log(model);
    scene.add(cube);
    // drawVertices(cube);
  }*/

  // obj loader
  /*{
    const objLoader = new OBJLoader();
    objLoader.load('../models/HumanBaseMesh.obj',
    // called when resource is loaded
    function ( object ) {
      // model = object.children[0];
      // model.geometry = BufferGeometryUtils.mergeVertices(model.geometry);
      // console.log(model);


      controls.target.x = model.position.x;
      controls.target.y = model.position.y + 2; // 10
      controls.target.z = model.position.z;
      controls.update();
      // scene.add(model);
    },
    // called when loading is in progresses
    function ( xhr ) {
      console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );
    },
    // called when loading has errors
    function ( error ) {
      console.log('An error happened: ', error);
    });
  }*/

  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('wheel', onWheel);
  document.getElementById("input").onchange = loadInput;
  console.log(scene);
}


function animate() {
  requestAnimationFrame(animate);
  render();
  update();
}

// rendering
function render() {
  function resizeRendererToDisplaySize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }

  if (resizeRendererToDisplaySize(renderer)) {
    const canvas = renderer.domElement;
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
  }

  // render normal scene
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  renderer.clear();
  renderer.render(scene, camera);

  //render axes
  renderer.setViewport(window.innerWidth - window.innerHeight / 8, 0, window.innerHeight / 8, window.innerHeight / 8);
  renderer.render(axes_scene, camera);
}


function update() {
  scene.children.forEach(element => {
    if (element.name == "marked vertex") element.scale.setScalar(point_scale);
  });

  if (variance_changed) {
    computeAndShowPosterior();
    variance_changed = false;
  }

  if (vertex_change.length() > 0) {
    const model_position = model.geometry.getAttribute('position');
    let model_old_pos = model_position;
    let marked_vertex_old_pos = marked_vertex.position;
    if (reset_orig_flag) {
      model_old_pos = model.geometry.getAttribute('original_position');
      marked_vertex_old_pos = marked_vertex.original_position;
      reset_orig_flag = false;
    }

    model_position.setXYZ(marked_vertex_index, 
      model_old_pos.getX(marked_vertex_index) + vertex_change.x, 
      model_old_pos.getY(marked_vertex_index) + vertex_change.y, 
      model_old_pos.getZ(marked_vertex_index) + vertex_change.z);
    
    model_position.needsUpdate = true;
    model.geometry.computeBoundingSphere();

    marked_vertex.position.set(marked_vertex_old_pos.x + vertex_change.x, marked_vertex_old_pos.y + vertex_change.y, marked_vertex_old_pos.z + vertex_change.z);

    vertex_change.set(0, 0, 0);
  }

  controls.update();
}


function createPoint(position) {
  let point = new THREE.Mesh( new THREE.SphereGeometry(0.1, 16, 16), new THREE.MeshBasicMaterial({color: 0xFF5555}));
  point.position.set(...position);
  point.original_position = new THREE.Vector3(...position);
  point.name = "marked vertex";
  point.marked_x = false;
  point.marked_y = false;
  point.marked_z = false;
  
  const arrow_x = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 0xff0000, 0.5, 0.5);
  arrow_x.name = "x_axis";
  arrow_x.children[0].name = "x_axis";
  arrow_x.children[1].name = "x_axis";
  arrow_x.children[0].material.transparent = true;
  arrow_x.children[0].material.opacity = 0.5;
  arrow_x.children[1].material.transparent = true;
  arrow_x.children[1].material.opacity = 0.5;
  const arrow_y = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1, 0x00ff00, 0.5, 0.5);
  arrow_y.name = "y_axis";
  arrow_y.children[0].name = "y_axis";
  arrow_y.children[1].name = "y_axis";
  arrow_y.children[0].material.transparent = true;
  arrow_y.children[0].material.opacity = 0.5;
  arrow_y.children[1].material.transparent = true;
  arrow_y.children[1].material.opacity = 0.5;
  const arrow_z = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, 0), 1, 0x0000ff, 0.5, 0.5);
  arrow_z.name = "z_axis";
  arrow_z.children[0].name = "z_axis";
  arrow_z.children[1].name = "z_axis";
  arrow_z.children[0].material.transparent = true;
  arrow_z.children[0].material.opacity = 0.5;
  arrow_z.children[1].material.transparent = true;
  arrow_z.children[1].material.opacity = 0.5;
  point.add(arrow_x);
  point.add(arrow_y);
  point.add(arrow_z);
  
  scene.add(point);

  return point;
}

function updateMarkedVertex(position) {
  if (marked_vertex == undefined)
    marked_vertex = createPoint(position);
  else {
    reset_vertex_gui();
    marked_vertex.position.set(...position);
    marked_vertex.original_position.set(...position);
  }
}

function getVertices(object) {
  let tmp = object.geometry.attributes.position.array;
  let vertices = new Array;
  for (let i = 0; i < tmp.length; i += 3) {
    vertices.push(new THREE.Vector3(tmp[i], tmp[i + 1], tmp[i + 2]));
  }
  return vertices;
}

function drawNearestVertex(clicked_position) {
  let vertex_positions = getVertices(model);
  let nearestPoint = vertex_positions[0];
  marked_vertex_index = 0;
  for (let i = 0; i < vertex_positions.length; i++) {
    if (clicked_position.distanceTo(vertex_positions[i]) < clicked_position.distanceTo(nearestPoint)) {
      nearestPoint = vertex_positions[i];
      marked_vertex_index = i;
    }
  };
  model_vertices.geometry.attributes.color.setXYZ(marked_vertex_index, 0, 1, 0);
  model_vertices.geometry.attributes.color.needsUpdate = true;
  updateMarkedVertex(nearestPoint);
}

function drawVertices(mesh, name) {
  let vertices = mesh.geometry.getAttribute('position');
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', vertices);
  geometry.setAttribute('color', new THREE.BufferAttribute(Float32Array.from({length: 3 * vertices.count}, (_, i) => i % 3 == 0 ? 1 : 0), 3));
  let material = new THREE.PointsMaterial({vertexColors: true});
  let points = new THREE.Points(geometry, material);
  points.name = name;
  if (model_vertices != undefined)
    points.visible = model_vertices.visible;
  // console.log(points);
  model_vertices = points;
  scene.add(points);
}

function loadMesh(vertices, indices, name) {
  let geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  let material = new THREE.MeshPhongMaterial({color: 0xf0f0f0});  // side: THREE.DoubleSide to turn off backface culling
  let mesh = new THREE.Mesh(geometry, material);

  mesh.geometry = BufferGeometryUtils.mergeVertices(mesh.geometry);
  mesh.geometry.computeVertexNormals();
  
  const position = mesh.geometry.getAttribute('position');
  mesh.geometry.attributes.original_position = position.clone();
  mesh.name = name;
  // console.log(mesh);
  model = mesh;
  scene.add(mesh);
}

function centerMeshPosition(position_matrix) {
  // subtract average position from every point to center mesh to origin of space
  let avg_position = position_matrix.map(dim => (dim.reduce((a, b) => a + b, 0) / dim.length));
  position_matrix = Math.transpose(position_matrix);
  position_matrix.forEach(elem => {
    for (let i = 0; i < elem.length; i++) {
      elem[i] -= avg_position[i];
    }
  });
  return new Float32Array(Math.flatten(position_matrix));
}

function computeAndShowPosterior() {
  let point_indices = model.userData.point_indices;
  let mean = model.userData.mean; // mean of prior model
  let W = model.userData.W; // matrix containing principal components
  let variance = model.userData.variance; // variance of above matrix; earlier components have a higher variance
  let z = model.userData.z; // parameter to scale variance
  z = Math.subset(z, Math.index(pca_index), variance_scale);

  // math based on 12.2 Probabilistic PCA p.573 TODO: book name
  let x = Math.add(Math.multiply(W, Math.dotMultiply(z, variance)), mean);  // x = W * z * variance + mean
  console.log(x); // dim: 5265 ~ 1

  // computation for posterior mean
  /*
  let WT = Math.transpose(W);
  console.log(WT);  // dim: 199 ~ 5265
  let M = Math.multiply(WT, W);
  M = Math.add(M, Math.multiply(Math.dot(variance, variance), Math.identity(Math.size(M)))); // M = W^T * W + variance^2 * I
  console.log(M); // dim: 199 ~ 199
  let M_inverse = Math.inv(M);
  // let posterior_mean = Math.multiply(Math.multiply(M_inverse, WT), Math.subtract(x, mean)); // M^-1 * W^T * (x - mean)
  // new formula: mean + W * M^-1 * W^T * (x - mean)
  let WM = Math.multiply(W, M_inverse);
  console.log(WM);
  let posterior_mean = Math.multiply(Math.multiply(WM, WT), Math.subtract(x, mean));
  console.log(posterior_mean);  // TODO: wrong dimension, 199 when it should have 5265
  posterior_mean = Math.add(mean, posterior_mean);*/

  // TODO: fix centering with centerMeshPosition
  // position_matrix = Math.reshape(Math.subtract(Math.matrix(template_points.value), x).toArray(), template_points.shape);
  // point_positions = centerMeshPosition(position_matrix);

  scene.remove(scene.getObjectByName("model"));
  scene.remove(scene.getObjectByName("points"));
  loadMesh(new Float32Array(x.toArray()), point_indices, "model");
  drawVertices(model, "points");
  
  model.userData.mean = mean;
  model.userData.W = W;
  model.userData.variance = variance;
  model.userData.z = z;
  model.userData.point_indices = point_indices;
}

function reset_vertex_gui() {
  vertex_change.set(0, 0, 0);
  vertex_folder.__controllers.forEach(controller => controller.setValue(controller.initialValue));
}



function onMouseDown(event) {
  mouse_down = true;
  if (event.target != document.querySelector('#c')) return;
  let mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);

  if (window.event.ctrlKey) { // set marked vertex with crtl + click
    let intersects = raycaster.intersectObject(model);
    if (intersects.length == 0) {
      console.log("no intersection with the model found");
      scene.remove(scene.getObjectByName("marked vertex"));
      marked_vertex = undefined;
      return;
    }
    console.log("intersection point: ", intersects[0].point);
    drawNearestVertex(intersects[0].point);
    return;
  }
  
  // change marked vertex position
  if (marked_vertex == undefined) return;
  let intersects = raycaster.intersectObject(marked_vertex);
  if (intersects.length == 0) {
    console.log("no intersection with the arrow axes found");
    return;
  }
  console.log(intersects[0].object.name);
  intersects[0].object.parent.children[0].material.opacity = 1;
  intersects[0].object.parent.children[1].material.opacity = 1;
  if (intersects[0].object.name == "x_axis") marked_vertex.marked_x = true;
  else if (intersects[0].object.name == "y_axis") marked_vertex.marked_y = true;
  else if (intersects[0].object.name == "z_axis") marked_vertex.marked_z = true;
}


function onMouseUp(event) {
  mouse_down = false;
  if (marked_vertex == undefined) return;
  marked_vertex.children.forEach(child => {
    child.children[0].material.opacity = 0.5;
    child.children[1].material.opacity = 0.5;
  });

  marked_vertex.marked_x = false;
  marked_vertex.marked_y = false;
  marked_vertex.marked_z = false;
}


function onMouseMove(event) {
  if (!mouse_down || marked_vertex == undefined ||
      !(marked_vertex.marked_x || marked_vertex.marked_y || marked_vertex.marked_z)) {
    controls.enableRotate = true;
    return;
  }
  controls.enableRotate = false;

  if (marked_vertex.marked_x) vertex_change.x = event.movementX / 4;
  if (marked_vertex.marked_y) vertex_change.y = -(event.movementY / 4);
  if (marked_vertex.marked_z) vertex_change.z = event.movementX / 4;
}


function onWheel(event) {
  if (marked_vertex == undefined) {
    controls.enableZoom = true;
    return;
  }
  controls.enableZoom = false;
  let mouse = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(mouse, camera);
  let scroll_vector = raycaster.ray.direction.multiplyScalar(event.deltaY * 0.05);
  
  if (scroll_vector.length() > vertex_change.length()) vertex_change = scroll_vector;
}

function loadInput(event) {
  let file = document.getElementById('input').files[0];
  
  // hdf5 loader  https://github.com/usnistgov/jsfive
  let reader = new FileReader();
  reader.onloadend = function(evt) { 
    let array_buffer = evt.target.result;
    let f = new hdf5.File(array_buffer, file.name);

    // loading template model
    let template_points = f.get('shape/representer/points');  // coordinates of template model points
    let template_cells = f.get('shape/representer/cells');    // indices of template model for triangles

    // weird I would have to do this but input has flipped dimensions?
    let point_indices = new Uint16Array(Math.flatten(Math.transpose(Math.reshape(template_cells.value, template_cells.shape))));

    let position_matrix =  Math.reshape(template_points.value, template_points.shape);
    let point_positions = centerMeshPosition(position_matrix);
    
    loadMesh(point_positions, point_indices, "template_model");
    drawVertices(model, "template_points");
    model.visible = false;
    model_vertices.visible = false;

    // loading prior model
    let mean = Math.matrix(f.get('shape/model/mean').value);
    let pca_basis = f.get('shape/model/pcaBasis');
    let W = Math.matrix(Math.reshape(pca_basis.value, pca_basis.shape));
    let variance = Math.matrix(f.get('shape/model/pcaVariance').value);
    let z = Math.zeros(Math.size(variance));

    model.userData.point_indices = point_indices;
    model.userData.mean = mean;
    model.userData.W = W;
    model.userData.variance = variance;
    model.userData.z = z;

    computeAndShowPosterior();
  }
  reader.readAsArrayBuffer(file);
}

