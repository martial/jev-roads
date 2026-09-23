import * as THREE from 'three';

/** Metre-scale wear and rain films stay continuous where road ribbons meet at a junction. */
export function roadSurface(material: THREE.MeshStandardMaterial, wet: { value: number }, pavement = false) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uSurfaceWet = wet;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vStreet;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStreet=position.xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', /* glsl */ `#include <common>
      varying vec2 vStreet; uniform float uSurfaceWet;
      float streetHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float streetNoise(vec2 p) {
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(streetHash(i),streetHash(i+vec2(1,0)),f.x),mix(streetHash(i+vec2(0,1)),streetHash(i+vec2(1)),f.x),f.y);
      }
      float waterFilm=0.0;
    `).replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
      float puddle=smoothstep(.27,.68,streetNoise(vStreet*.31)*.7+streetNoise(vStreet*1.2)*.3);
      waterFilm=uSurfaceWet*(.18+.82*puddle);
      ${pavement ? `
        vec2 cell=vStreet/vec2(.6,.9);
        float stone=streetHash(floor(cell));
        vec2 seam=min(fract(cell),1.0-fract(cell));
        float grout=1.0-smoothstep(.006,.023,min(seam.x,seam.y));
        diffuseColor.rgb*=mix(.84,1.12,stone)*(1.0-grout*.32);
      ` : `
        vec2 repair=fract(vStreet/vec2(5.1,8.3));
        float repaired=step(.74,streetHash(floor(vStreet/vec2(5.1,8.3))));
        repaired*=smoothstep(.09,.115,repair.x)*(1.0-smoothstep(.81,.83,repair.x));
        repaired*=smoothstep(.18,.195,repair.y)*(1.0-smoothstep(.79,.81,repair.y));
        float vein=abs(streetNoise(vStreet*.82)-.48);
        float crack=(1.0-smoothstep(.003,.01+fwidth(vein),vein))*.24;
        diffuseColor.rgb*=1.0-repaired*.19-crack;
      `}
      diffuseColor.rgb*=mix(1.0,${pavement ? '.78' : '.58'},uSurfaceWet);
    `).replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor=mix(${pavement ? '.91' : '.94'},.095,waterFilm);`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize(mix(normal,nonPerturbedNormal,waterFilm*.88));');
  };
  material.customProgramCacheKey = () => `street-surface-${pavement ? 'stone' : 'asphalt'}-v1`;
}

/**
 * The open land between the buildings, seen from a seat a metre up: the baked texture (a texel a metre) gives
 * the colour, this gives what a metre hides. The texture's alpha says how built-up a square metre is (1 paved,
 * 0.5 wild, below that it is water and cut away): paving slabs with dirty joints near the houses, soil,
 * pebbles and tufts of dry grass further out, and puddles that darken and turn glossy in the rain.
 */
export function groundSurface(material: THREE.MeshStandardMaterial, wet: { value: number }) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGroundWet = wet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround=position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
      varying vec2 vGround; uniform float uGroundWet;
      float groundHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float groundNoise(vec2 p) {
        vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1)),f.x),f.y);
      }
      float groundFilm=0.0;
    `,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
      // How built-up this square metre is, from the texture's alpha (0.5 wild .. 1 paved).
      float built=clamp((sampledDiffuseColor.a-.5)*2.0,0.0,1.0);
      float fade=1.0-smoothstep(40.0,140.0,length(vViewPosition));
      // Slabs a metre square, a little uneven, with dark joints and the odd stain.
      vec2 slab=vGround/vec2(1.0,.75)+vec2(step(1.0,mod(floor(vGround.y/.75),2.0))*.5,0.0);
      vec2 seam=min(fract(slab),1.0-fract(slab));
      float joint=1.0-smoothstep(.012,.035+fwidth(slab.x),min(seam.x,seam.y));
      float slabTone=mix(.86,1.1,groundHash(floor(slab)));
      float stain=smoothstep(.55,.85,groundNoise(vGround*.35))*.22;
      float paved=slabTone*(1.0-joint*.4)*(1.0-stain);
      // Soil and dry grass: clumps at three scales, pebbles, dark hollows.
      float clump=groundNoise(vGround*.23)*.55+groundNoise(vGround*1.1)*.3+groundNoise(vGround*4.3)*.15;
      float pebble=step(.93,groundHash(floor(vGround*6.0)))*.18;
      float wild=mix(.72,1.18,clump)+pebble;
      vec3 detail=mix(vec3(wild)*mix(vec3(1.0),vec3(.9,1.04,.86),smoothstep(.45,.75,clump)),vec3(paved),built);
      diffuseColor.rgb*=mix(vec3(1.0),detail,fade);
      // Water stays cut away (alpha 0); every kind of land is solid.
      diffuseColor.a=step(.25,sampledDiffuseColor.a);
      // Rain: a film everywhere, deeper in the hollows and on the slabs.
      float puddle=smoothstep(.3,.7,groundNoise(vGround*.27)*.7+groundNoise(vGround*1.3)*.3);
      groundFilm=uGroundWet*(.15+.85*puddle)*mix(.55,1.0,built);
      diffuseColor.rgb*=1.0-uGroundWet*mix(.3,.42,built);
    `,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.12,groundFilm);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal=normalize(mix(normal,nonPerturbedNormal,groundFilm*.85));');
  };
  material.customProgramCacheKey = () => 'jev-ground-detail-v1';
}
