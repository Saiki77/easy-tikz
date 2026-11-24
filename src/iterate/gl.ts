/*
 * The GPU's way to paint a pixel layer (6.0 E): one WebGL 1 context for
 * the whole plugin (browsers allow few), its programs kept by shader text,
 * drawn into a canvas of the layer's size and copied into the layer's own
 * canvas. Sliders are uniforms, so moving one needs no new program. When
 * WebGL is missing, the context is lost, highp floats are missing or a
 * shader does not compile, drawGpu says so and the CPU paints instead.
 */
import type { View } from '../geometry';
import type { PixelPrim } from './pixels';

/** Pixels the GPU paints in one go at most. */
export const MAX_GPU_PIXELS = 2500000;
/** Below this pixel size relative to the coordinates, 32-bit floats blur: the CPU (64-bit) paints. */
const MIN_RELATIVE_PIXEL = 4e-6;

const VERTEX = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';

interface Program {
    program: WebGLProgram;
    origin: WebGLUniformLocation | null;
    step: WebGLUniformLocation | null;
    steps: WebGLUniformLocation | null;
    uniforms: Map<string, WebGLUniformLocation | null>;
}

interface GpuState {
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext;
    programs: Map<string, Program | null>;
    lost: boolean;
}

/** undefined: not tried yet; null: no WebGL here. */
let state: GpuState | null | undefined;

function setup(): GpuState | null {
    if (state !== undefined && !(state && state.lost)) return state;
    state = null;
    try {
        const canvas = createEl('canvas');
        const gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
        if (!gl) return null;
        const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        if (!high || high.precision < 23) return null;
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        // One triangle over the whole canvas.
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const s: GpuState = { canvas, gl, programs: new Map(), lost: false };
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            s.lost = true;
        });
        state = s;
        return s;
    } catch {
        state = null;
        return null;
    }
}

function shader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
    }
    return sh;
}

function programFor(s: GpuState, prim: PixelPrim): Program | null {
    const src = prim.shader ? prim.shader.source : '';
    if (s.programs.has(src)) return s.programs.get(src) ?? null;
    const gl = s.gl;
    let made: Program | null = null;
    const vs = shader(gl, gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl, gl.FRAGMENT_SHADER, src);
    if (vs && fs) {
        const program = gl.createProgram();
        if (program) {
            gl.attachShader(program, vs);
            gl.attachShader(program, fs);
            gl.bindAttribLocation(program, 0, 'a_pos');
            gl.linkProgram(program);
            if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
                const uniforms = new Map<string, WebGLUniformLocation | null>();
                for (const u of prim.shader?.uniforms ?? []) uniforms.set(u.uniform, gl.getUniformLocation(program, u.uniform));
                made = { program, origin: gl.getUniformLocation(program, 'u_origin'), step: gl.getUniformLocation(program, 'u_step'), steps: gl.getUniformLocation(program, 'u_steps'), uniforms };
            } else gl.deleteProgram(program);
        }
    }
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    // Few programs at a time: a chart whose let values change makes new ones.
    if (s.programs.size > 12) {
        for (const [key, p] of s.programs) {
            if (p) gl.deleteProgram(p.program);
            s.programs.delete(key);
            if (s.programs.size <= 6) break;
        }
    }
    s.programs.set(src, made);
    return made;
}

/** Can the GPU paint this view at this size (enough precision and not too many pixels)? */
export function gpuFits(view: View, w: number, h: number): boolean {
    if (w * h > MAX_GPU_PIXELS) return false;
    const scale = Math.max(Math.abs(view.xmin), Math.abs(view.xmax), Math.abs(view.ymin), Math.abs(view.ymax), 1e-30);
    const px = Math.min((view.xmax - view.xmin) / w, (view.ymax - view.ymin) / h);
    return px / scale > MIN_RELATIVE_PIXEL;
}

/** Paint the layer into `target` (w x h) on the GPU; false when the GPU cannot (the CPU paints then). */
export function drawGpu(prim: PixelPrim, view: View, w: number, h: number, target: CanvasRenderingContext2D): boolean {
    if (!prim.shader || !gpuFits(view, w, h)) return false;
    const s = setup();
    if (!s || s.lost) return false;
    const gl = s.gl;
    if (gl.isContextLost()) {
        s.lost = true;
        return false;
    }
    const p = programFor(s, prim);
    if (!p) return false;
    try {
        if (s.canvas.width !== w) s.canvas.width = w;
        if (s.canvas.height !== h) s.canvas.height = h;
        gl.viewport(0, 0, w, h);
        gl.useProgram(p.program);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(p.origin, view.xmin, view.ymin);
        gl.uniform2f(p.step, (view.xmax - view.xmin) / w, (view.ymax - view.ymin) / h);
        gl.uniform1f(p.steps, prim.cost);
        for (const u of prim.shader.uniforms) gl.uniform1f(p.uniforms.get(u.uniform) ?? null, u.read());
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        target.clearRect(0, 0, w, h);
        target.drawImage(s.canvas, 0, 0);
        return true;
    } catch {
        return false;
    }
}
