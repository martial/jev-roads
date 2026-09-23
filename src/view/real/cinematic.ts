import * as THREE from 'three';

/** Reuse the AO depth/normal buffer: reflections cost one screen pass, not a second render of the city. */
export const StreetReflections = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, tNormal: { value: null },
    projection: { value: new THREE.Matrix4() }, inverseProjection: { value: new THREE.Matrix4() }, cameraWorld: { value: new THREE.Matrix4() },
    near: { value: .08 }, far: { value: 9000 }, wet: { value: 0 }, time: { value: 0 }, groundHeight: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse, tDepth, tNormal;
    uniform mat4 projection, inverseProjection, cameraWorld;
    uniform float near, far, wet, time, groundHeight;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p) {
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
    }
    float viewZ(float depth) { return near * far / ((far - near) * depth - far); }
    vec3 viewPosition(vec2 uv, float depth) {
      vec4 p=inverseProjection*vec4(uv*2.0-1.0,depth*2.0-1.0,1.0); return p.xyz/p.w;
    }
    void main() {
      vec4 base=texture2D(tDiffuse,vUv);
      gl_FragColor=base;
      float depth=texture2D(tDepth,vUv).x;
      if(wet<.02 || depth>=.99999) return;
      vec3 p=viewPosition(vUv,depth);
      vec3 n=normalize(texture2D(tNormal,vUv).xyz*2.0-1.0);
      vec3 wn=normalize(mat3(cameraWorld)*n);
      vec3 world=(cameraWorld*vec4(p,1)).xyz;
      // Ground only. The dashboard, bonnet, roofs and vertical walls are not puddles.
      if(wn.y<.86 || -p.z<2.6 || abs(world.y-groundHeight)>1.8) return;
      float puddle=smoothstep(.27,.68,noise(world.xz*.31)*.7+noise(world.xz*1.2)*.3);
      float amount=wet*(.12+.88*puddle);
      vec3 ray=reflect(normalize(p),n);
      vec3 origin=p+n*.09;
      float previous=0.0;
      for(int i=0;i<48;i++) {
        float distance=.16+float(i)*.13+float(i*i)*.018;
        vec3 samplePos=origin+ray*distance;
        if(samplePos.z>=-.1) break;
        vec4 clip=projection*vec4(samplePos,1);
        vec2 uv=clip.xy/clip.w*.5+.5;
        if(any(lessThan(uv,vec2(.015))) || any(greaterThan(uv,vec2(.985)))) break;
        float targetDepth=texture2D(tDepth,uv).x;
        float delta=viewZ(targetDepth)-samplePos.z;
        if(targetDepth<.99999 && delta>0.0 && delta<.16+distance*.009 && distance>1.2) {
          float a=previous, b=distance;
          for(int j=0;j<4;j++) {
            float mid=(a+b)*.5; vec3 q=origin+ray*mid;
            vec4 projected=projection*vec4(q,1); vec2 at=projected.xy/projected.w*.5+.5;
            if(viewZ(texture2D(tDepth,at).x)-q.z>0.0) b=mid; else a=mid;
          }
          vec4 projected=projection*vec4(origin+ray*b,1);
          uv=projected.xy/projected.w*.5+.5;
          // A water film breaks the reflected image very slightly; the source remains the actual city.
          uv+=vec2(sin(world.z*33.0+time*2.0),cos(world.x*29.0-time*1.5))*.00065*wet;
          float edge=smoothstep(0.0,.12,min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y)));
          float fresnel=.12+.65*pow(1.0-max(0.0,dot(normalize(-p),n)),3.0);
          float fade=edge*(1.0-smoothstep(22.0,45.0,b));
          vec3 reflected=texture2D(tDiffuse,uv).rgb*.5;
          reflected+=(texture2D(tDiffuse,uv+vec2(.0011,0)).rgb+texture2D(tDiffuse,uv-vec2(.0011,0)).rgb)*.25;
          gl_FragColor.rgb=mix(base.rgb,reflected,clamp(amount*fresnel*fade,.0,.68));
          break;
        }
        previous=distance;
      }
    }`,
};

/** A restrained display-space finish: cool shadow detail, warm highlights and gentle lens falloff. */
export const FilmFinish = {
  uniforms: { tDiffuse: { value: null }, night: { value: 0 } },
  vertexShader: StreetReflections.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float night; varying vec2 vUv;
    void main() {
      vec4 c=texture2D(tDiffuse,vUv);
      float l=dot(c.rgb,vec3(.2126,.7152,.0722));
      c.rgb+=vec3(-.007,.003,.013)*(1.0-smoothstep(.08,.6,l))*(.5+night*.5);
      c.rgb+=vec3(.01,.004,-.004)*smoothstep(.45,.95,l);
      c.rgb=(c.rgb-.5)*1.035+.5;
      vec2 lens=vUv*(1.0-vUv);
      c.rgb*=.88+.12*pow(clamp(lens.x*lens.y*16.0,0.0,1.0),.3);
      gl_FragColor=vec4(clamp(c.rgb,0.0,1.0),c.a);
    }`,
};
