"use client";
import {
  Box,
  Camera,
  Mesh,
  Plane,
  Program,
  Renderer,
  RenderTarget,
  Transform,
  Vec3
} from "ogl";
import { useEffect, useRef } from "react";
import { Overlay } from "../overlay";

const DESKTOP_HEIGHT = 256;
const MOBILE_HEIGHT = 356;

export const HeroASCII = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    const vertex = `#version 300 es
in vec3 position;
in vec3 normal;
in vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat3 normalMatrix;
out vec2 vUv;
out vec3 vNormal;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
    const fragment = `#version 300 es
precision mediump float;
uniform float uTime;
in vec2 vUv;
in vec3 vNormal;
out vec4 fragColor;
void main() {
  // Simple lighting from the top-left
  vec3 lightDir = normalize(vec3(-1.0, 1.0, 1.0));
  float light = max(0.1, dot(vNormal, lightDir)) * 0.9 + 0.2;
  // Basic white color with light intensity
  fragColor = vec4(light, light, light, 1.0);
}`;
    const asciiVertex = `#version 300 es
in vec2 uv;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0., 1.);
}`;
    const asciiFragment = `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform sampler2D uTexture;
out vec4 fragColor;
float character(int n, vec2 p) {
  // character grid scale
  float scale = uResolution.x < 768.0 ? 6.0 : 4.0;
  p = floor(p * vec2(-scale, scale) + 2.5);
  if(clamp(p.x, 0.0, 4.0) == p.x && clamp(p.y, 0.0, 4.0) == p.y) {
    int a = int(round(p.x) + 5.0 * round(p.y));
    if(((n >> a) & 1) == 1) return 0.8;
  }
  return 0.0;
}
void main() {
  vec2 pix = gl_FragCoord.xy;
  // pixel size
  float pixelSize = uResolution.x < 768.0 ? 12.0 : 16.0;
  vec3 col = texture(uTexture, floor(pix / pixelSize) * pixelSize / uResolution.xy).rgb;
  float gray = 0.3 * col.r + 0.59 * col.g + 0.11 * col.b;
  int n = 2048;
  if(gray > 0.2) n = 65600;
  if(gray > 0.3) n = 163153;
  if(gray > 0.4) n = 15255086;
  if(gray > 0.5) n = 13121101;
  if(gray > 0.6) n = 15252014;
  if(gray > 0.7) n = 13195790;
  if(gray > 0.8) n = 11512810;
  // char size
  float charSize = uResolution.x < 768.0 ? 6.0 : 8.0;
  vec2 p = mod(pix / charSize, 2.0) - vec2(1.0);
  col = vec3(character(n, p));
  if (gray < 0.2) {
    col *= 0.4;
  }
  fragColor = vec4(col, 1.0);
}`;
    const renderer = new Renderer({ antialias: true });
    const gl = renderer.gl;
    containerRef.current?.appendChild(gl.canvas);
    const camera = new Camera(gl, { near: 0.1, far: 100 });
    camera.position.set(2.2, 2.2, 2.2);
    camera.lookAt(new Vec3(0, 0, 0));

    const isMobile = () => window.innerWidth < 768; // Common breakpoint for mobile

    const updateSize = () => {
      const height = isMobile() ? MOBILE_HEIGHT : DESKTOP_HEIGHT;
      renderer.setSize(window.innerWidth - 32, window.innerHeight - height);
      camera.perspective({ aspect: gl.canvas.width / gl.canvas.height });
    };

    window.addEventListener("resize", updateSize);
    updateSize();
    const boxProgram = new Program(gl, {
      vertex: vertex,
      fragment: fragment,
      uniforms: {
        uTime: { value: 0 }
      },
      cullFace: false
    });
    const boxMesh = new Mesh(gl, {
      geometry: new Box(gl, { width: 1, height: 2, depth: 1 }),
      program: boxProgram
    });
    const renderTarget = new RenderTarget(gl);
    const asciiProgram = new Program(gl, {
      vertex: asciiVertex,
      fragment: asciiFragment,
      uniforms: {
        uResolution: { value: [gl.canvas.width, gl.canvas.height] },
        uTexture: { value: renderTarget.texture }
      }
    });
    const asciiMesh = new Mesh(gl, {
      geometry: new Plane(gl, { width: 2, height: 2 }),
      program: asciiProgram
    });
    const boxScene = new Transform();
    boxMesh.setParent(boxScene);
    const asciiScene = new Transform();
    asciiMesh.setParent(asciiScene);

    const MAX_TILT = 0.2;
    const LERP_FACTOR = 0.05;

    // Add hover and touch animation
    let targetRotationX = 0;
    let targetRotationY = 0;
    let targetRotationZ = 0;
    let currentRotationX = 0;
    let currentRotationY = 0;
    let currentRotationZ = 0;
    let isDragging = false;

    function onMouseMove(e: MouseEvent) {
      const x = (e.clientX / window.innerWidth) * 2 - 1;
      const y = (e.clientY / window.innerHeight) * 2 - 1;

      targetRotationX = y * MAX_TILT;
      targetRotationY = x * MAX_TILT;
      targetRotationZ = -y * MAX_TILT;
    }

    function onTouchStart(e: TouchEvent) {
      isDragging = true;
      // Prevent default touch behavior
      e.preventDefault();
    }

    function onTouchMove(e: TouchEvent) {
      if (!isDragging) return;

      // Prevent default touch behavior
      e.preventDefault();

      const touchX = e.touches[0].clientX;
      const touchY = e.touches[0].clientY;

      const x = (touchX / window.innerWidth) * 2 - 1;
      const y = (touchY / window.innerHeight) * 2 - 1;

      targetRotationX = y * MAX_TILT;
      targetRotationY = x * MAX_TILT;
      targetRotationZ = -y * MAX_TILT;
    }

    function onTouchEnd() {
      isDragging = false;
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);

    function update(time: number) {
      const elapsedTime = time * 0.001;
      boxProgram.uniforms.uTime.value = elapsedTime;

      // Smoothly interpolate current rotation towards target rotation
      currentRotationX += (targetRotationX - currentRotationX) * LERP_FACTOR;
      currentRotationY += (targetRotationY - currentRotationY) * LERP_FACTOR;
      currentRotationZ += (targetRotationZ - currentRotationZ) * LERP_FACTOR;

      // Apply rotation to the box
      boxMesh.rotation.x = currentRotationX;
      boxMesh.rotation.y = currentRotationY;
      boxMesh.rotation.z = currentRotationZ;

      renderer.render({ scene: boxScene, camera, target: renderTarget });
      asciiProgram.uniforms.uResolution.value = [
        gl.canvas.width,
        gl.canvas.height
      ];
      renderer.render({ scene: asciiScene, camera });
    }

    let animationId: number;
    function animate(time: number) {
      update(time);
      animationId = requestAnimationFrame(animate);
    }
    animationId = requestAnimationFrame(animate);
    return () => {
      window.removeEventListener("resize", updateSize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      cancelAnimationFrame(animationId);
      renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
      if (container?.contains(gl.canvas)) {
        container.removeChild(gl.canvas);
      }
    };
  }, []);

  return (
    <div className="w-full h-full overflow-clip">
      <div
        ref={containerRef}
        className="w-[calc(100%-2rem)] mx-4 h-full overflow-clip"
      ></div>
      <Overlay />
    </div>
  );
};
