import {
    PerspectiveCamera,
    Scene,
    BoxGeometry,
    MeshNormalMaterial,
    Mesh,
    WebGLRenderer

} from '../node_modules/three/src/Three.js';

import {SvgPlus} from "../SvgPlus/4.js";

class Main extends SvgPlus {
    constructor(){
        super("three-js");
        this.camera = new PerspectiveCamera( 70, 1, 0.01, 10 );
        this.camera.position.z = 1;
        this.scene = new Scene();
        const geometry = new BoxGeometry( 0.2, 0.2, 0.2 );
        const material = new MeshNormalMaterial();
        this.mesh = new Mesh( geometry, material );
        this.scene.add( this.mesh );

        this.renderer = new WebGLRenderer( { antialias: true } );
        this.renderer.setAnimationLoop( this.onFrame.bind(this) );
        this.appendChild( this.renderer.domElement );

        this._resizeObserver = new ResizeObserver(this.resize.bind(this));
        this._resizeObserver.observe(this);
    }


    /**
     * @param {ResizeObserverEntry[]} e
     */
    resize(e){
        const {width, height} = e[0].contentRect
        console.log(width, height);
        this.renderer.setSize( width, height );
        this.renderer.setPixelRatio( window.devicePixelRatio );
        let oldCamera = this.camera;
        this.camera = new PerspectiveCamera( 70, width / height, 0.01, 10 );
        this.camera.position.copy(oldCamera.position);
    }


    onFrame(time){
        this.mesh.rotation.x = time / 2000;
        this.mesh.rotation.y = time / 1000;

        this.renderer.render( this.scene, this.camera );
    }
}


document.body.appendChild(new Main());







