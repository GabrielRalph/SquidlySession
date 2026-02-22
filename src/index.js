import {
    PerspectiveCamera,
    Scene,
    BoxGeometry,
    MeshPhysicalMaterial,
    Mesh,
    WebGLRenderer,
    DirectionalLight,
    AmbientLight,
    TextureLoader,
    SRGBColorSpace,
    EquirectangularReflectionMapping,
    Color

} from '../node_modules/three/src/Three.js';

import {SvgPlus} from "../SvgPlus/4.js";

class Main extends SvgPlus {
    constructor(){
        super("three-js");
        this.camera = new PerspectiveCamera( 70, 1, 0.01, 10 );
        this.camera.position.z = 1;
        this.scene = new Scene();
        const geometry = new BoxGeometry( 0.2, 0.2, 0.2 );
        const material = new MeshPhysicalMaterial( { color: 0xe1fde1, roughness: 0.1, metalness: 1 } ); // #e1fde1
        this.mesh = new Mesh( geometry, material );
        this.scene.add( this.mesh );

        const light = new DirectionalLight( 0xffffff, 1 );
        light.position.set( 1, 1, 1 );

        const ambientLight = new AmbientLight( 0x404040); // soft white light
        ambientLight.intensity = 30
        this.scene.add( ambientLight );
        this.scene.add(light  );

        this.renderer = new WebGLRenderer( { antialias: true } );
        this.renderer.setAnimationLoop( this.onFrame.bind(this) );
        this.appendChild( this.renderer.domElement );

        this._resizeObserver = new ResizeObserver(this.resize.bind(this));
        this._resizeObserver.observe(this);

        let tloader = new TextureLoader();
        tloader.load("https://l13.alamy.com/360/T258GN/full-seamless-spherical-panorama-360-degrees-angle-view-on-bank-of-wide-river-in-front-of-bridge-in-city-center-360-panorama-in-equirectangular-proje-T258GN.jpg", (texture)=>{
             texture.colorSpace = SRGBColorSpace;
            texture.mapping = EquirectangularReflectionMapping;
            this.scene.environment = texture;
            this.scene.background = new Color(0xFFFFFF);;
            // scene.needsUpdate = true;
        })
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







