import {
    PerspectiveCamera,
    Scene,
    BoxGeometry,
    MeshNormalMaterial,
    Mesh,
    WebGLRenderer

} from '../node_modules/three/src/Three.js';

const width = window.innerWidth, height = window.innerHeight;

// init

const camera = new PerspectiveCamera( 70, width / height, 0.01, 10 );
camera.position.z = 1;

const scene = new Scene();

const geometry = new BoxGeometry( 0.2, 0.2, 0.2 );
const material = new MeshNormalMaterial();

const mesh = new Mesh( geometry, material );
scene.add( mesh );

const renderer = new WebGLRenderer( { antialias: true } );
renderer.setSize( width, height );
renderer.setAnimationLoop( animate );
document.body.appendChild( renderer.domElement );

function animate( time ) {

	mesh.rotation.x = time / 2000;
	mesh.rotation.y = time / 1000;

	renderer.render( scene, camera );
}