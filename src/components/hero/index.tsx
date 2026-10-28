/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import {
  Camera,
  GLTFLoader,
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

// Calculated heights: header + footer including all margins
// Header: 108px (h-[108px]) + 40px (m-10 top) + 24px (mb-6) = 172px
// Footer: 16px (mt-4) + 40px (m-10 bottom) + 84px (md:h-[84px]) + 36px (pt-4 + content) = 176px
// Total: 172px + 176px = 348px
const DESKTOP_HEIGHT = 334;
// Header: 72px (h-[72px]) + 16px (m-4 top) + 8px (mb-2) = 96px
// Footer: 8px (mt-2) + 16px (m-4 bottom) + 52px (py-4 + content) + 36px (pt-4 + content) = 112px
// Total: 96px + 112px = 208px
const MOBILE_HEIGHT = 200;

const DESKTOP_CAMERA_POSITION = new Vec3(5, -5, 10);
const MOBILE_CAMERA_POSITION = new Vec3(7, -7, 12);

const MAX_TILT = 0.4;
const LERP_FACTOR = 0.05;
// The tilt eases toward its target forever; once every axis is this close
// (radians, far below a pixel of movement) the frame can't change, so
// rendering stops until the pointer or the window moves again.
const SETTLE_EPSILON = 1e-4;
// Upper bound on waiting for the off-screen warm-up draw to finish on the GPU.
const WARM_UP_TIMEOUT_MS = 2000;

const vertex = /*glsl*/ `#version 300 es
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
const fragment = /*glsl*/ `#version 300 es
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
const asciiVertex = /*glsl*/ `#version 300 es
in vec2 uv;
in vec2 position;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0., 1.);
}`;
const asciiFragment = /*glsl*/ `#version 300 es
precision highp float;
uniform vec2 uResolution;
uniform sampler2D uTexture;
out vec4 fragColor;
float character(int n, vec2 p) {
  // character grid scale
  float scale = uResolution.x < 768.0 ? 5.0 : 6.0;
  p = floor(p * vec2(-scale, scale) + 2.5);
  if(clamp(p.x, 0.0, 6.0) == p.x && clamp(p.y, 0.0, 6.0) == p.y) {
    int a = int(round(p.x) + 5.0 * round(p.y));
    if(((n >> a) & 1) == 1) return 0.8;
  }
  return 0.0;
}
void main() {
  vec2 pix = gl_FragCoord.xy;
  // pixel size
  float pixelSize = uResolution.x < 768.0 ? 10.0 : 14.0;
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
  float charSize = 4.0;
  vec2 p = mod(pix / charSize, 2.0) - vec2(1.0);
  float char = character(n, p);

  vec3 charColor = vec3(1.0);
  if (gray < 0.2) {
    charColor *= 0.4;
  }

  fragColor = vec4(charColor, char);
}`;

// Runs `callback` once the main thread is idle, so WebGL setup doesn't share
// a task with hydration. Safari has no requestIdleCallback.
function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 1000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 1);
  return () => window.clearTimeout(id);
}

// Sets up the scene and returns a function that tears it down.
//
// Without a GPU (software GL, as in CI), the compositor reads the canvas back
// on the main thread each frame the canvas changes, so that frame blocks until
// all queued GPU work is done. The first draw with each shader is by far the
// slowest, so it happens while the canvas is still detached from the page,
// where nothing waits on it. The canvas goes in once that draw has finished.
//
// After that, frames are drawn only while the tilt is still easing toward the
// pointer, or after a resize. The scene has no other animation, so an idle
// page costs nothing per frame.
function startHero(container: HTMLDivElement): () => void {
  const isMobile = () => window.innerWidth < 768;

  // No antialiasing: only the full-screen ASCII quad is drawn to the canvas,
  // and multisampling a quad that covers every pixel changes nothing.
  const renderer = new Renderer({
    alpha: true,
    autoClear: true
  });
  const gl = renderer.gl;
  gl.clearColor(0.0627, 0.0627, 0.0627, 1.0);
  const camera = new Camera(gl, { near: 0.1, far: 100, fov: 10 });
  camera.position.set(
    isMobile() ? MOBILE_CAMERA_POSITION : DESKTOP_CAMERA_POSITION
  );
  camera.lookAt(new Vec3(0, 0, 0));

  const scene = new Transform();

  let disposed = false;
  let ready = false;
  let frameId = 0;

  const updateSize = () => {
    const height = isMobile() ? MOBILE_HEIGHT : DESKTOP_HEIGHT;
    renderer.setSize(window.innerWidth - 32, window.innerHeight - height);
    camera.perspective({
      aspect: (gl.canvas.width + 32) / gl.canvas.height
    });
  };
  updateSize();

  const renderTarget = new RenderTarget(gl);
  const asciiProgram = new Program(gl, {
    vertex: asciiVertex,
    fragment: asciiFragment,
    transparent: true,
    uniforms: {
      uResolution: { value: [gl.canvas.width, gl.canvas.height] },
      uTexture: { value: renderTarget.texture }
    }
  });
  const asciiMesh = new Mesh(gl, {
    geometry: new Plane(gl, { width: 2, height: 2 }),
    program: asciiProgram
  });
  const asciiScene = new Transform();
  asciiMesh.setParent(asciiScene);

  let targetRotationX = 0;
  let targetRotationY = 0;
  let targetRotationZ = 0;
  let currentRotationX = 0;
  let currentRotationY = 0;
  let currentRotationZ = 0;
  let isDragging = false;

  function render() {
    renderer.render({ scene, camera, target: renderTarget });
    asciiProgram.uniforms.uResolution.value = [
      gl.canvas.width,
      gl.canvas.height
    ];
    renderer.render({ scene: asciiScene, camera });
  }

  function frame() {
    frameId = 0;
    currentRotationX += (targetRotationX - currentRotationX) * LERP_FACTOR;
    currentRotationY += (targetRotationY - currentRotationY) * LERP_FACTOR;
    currentRotationZ += (targetRotationZ - currentRotationZ) * LERP_FACTOR;

    const settled =
      Math.abs(targetRotationX - currentRotationX) < SETTLE_EPSILON &&
      Math.abs(targetRotationY - currentRotationY) < SETTLE_EPSILON &&
      Math.abs(targetRotationZ - currentRotationZ) < SETTLE_EPSILON;
    if (settled) {
      currentRotationX = targetRotationX;
      currentRotationY = targetRotationY;
      currentRotationZ = targetRotationZ;
    }

    scene.rotation.x = currentRotationX;
    scene.rotation.y = currentRotationY;
    scene.rotation.z = currentRotationZ;

    render();

    if (!settled) requestRender();
  }

  function requestRender() {
    if (ready && !disposed && !frameId) {
      frameId = requestAnimationFrame(frame);
    }
  }

  function warmUp() {
    if (disposed) return;
    render();
    const showFirstFrame = () => {
      container.appendChild(gl.canvas);
      ready = true;
      requestRender();
    };
    if (!renderer.isWebgl2) {
      showFirstFrame();
      return;
    }
    const gl2 = gl as unknown as WebGL2RenderingContext;
    const sync = gl2.fenceSync(gl2.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl2.flush();
    const deadline = performance.now() + WARM_UP_TIMEOUT_MS;
    const poll = () => {
      frameId = 0;
      if (disposed) return;
      const done =
        !sync ||
        gl2.getSyncParameter(sync, gl2.SYNC_STATUS) === gl2.SIGNALED ||
        performance.now() > deadline;
      if (!done) {
        frameId = requestAnimationFrame(poll);
        return;
      }
      if (sync) gl2.deleteSync(sync);
      showFirstFrame();
    };
    frameId = requestAnimationFrame(poll);
  }

  async function loadModel() {
    const gltf: any = await GLTFLoader.load(gl, "/logo.glb");
    if (disposed) return;

    const s = gltf.scene || gltf.scenes[0];
    s.forEach((root: any) => {
      root.setParent(scene);
      root.traverse((node: any) => {
        if (node.program) {
          node.program = createProgram();
        }
      });
    });
  }

  function createProgram() {
    return new Program(gl, {
      vertex,
      fragment
    });
  }

  // Show the background grid even if the model fails to load.
  loadModel().catch(console.error).finally(warmUp);

  function onResize() {
    updateSize();
    requestRender();
  }

  function onMouseMove(e: MouseEvent) {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = (e.clientY / window.innerHeight) * 2 - 1;

    targetRotationX = y * MAX_TILT;
    targetRotationY = x * MAX_TILT;
    targetRotationZ = -y * MAX_TILT;
    requestRender();
  }

  function onTouchStart(e: TouchEvent) {
    isDragging = true;
    if (e.target instanceof HTMLCanvasElement) {
      e.preventDefault();
    }
  }

  function onTouchMove(e: TouchEvent) {
    if (!isDragging) return;

    // Prevent default touch behavior
    if (e.target instanceof HTMLCanvasElement) {
      e.preventDefault();
    }

    const touch = e.touches[0];
    if (!touch) return;
    const touchX = touch.clientX;
    const touchY = touch.clientY;

    const x = (touchX / window.innerWidth) * 2 - 1;
    const y = (touchY / window.innerHeight) * 2 - 1;

    targetRotationX = y * MAX_TILT;
    targetRotationY = x * MAX_TILT;
    targetRotationZ = -y * MAX_TILT;
    requestRender();
  }

  function onTouchEnd() {
    isDragging = false;
  }

  window.addEventListener("resize", onResize);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("touchend", onTouchEnd);

  return () => {
    disposed = true;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    cancelAnimationFrame(frameId);
    renderer.gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (container.contains(gl.canvas)) {
      container.removeChild(gl.canvas);
    }
  };
}

export const HeroASCII = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let stop: (() => void) | undefined;
    const cancelIdle = whenIdle(() => {
      stop = startHero(container);
    });
    return () => {
      cancelIdle();
      stop?.();
    };
  }, []);

  return (
    <div className="w-full overflow-clip md:h-[calc(100dvh-208px)] lg:h-[calc(100dvh-332px)]">
      <div
        ref={containerRef}
        className="w-[calc(100%-2rem)] md:w-[calc(100%-5rem)] mx-4 md:mx-10 h-full overflow-clip"
      ></div>
      <Overlay />
    </div>
  );
};
