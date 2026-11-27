// 零依赖 GLSL ES 3.00 安全压缩与局部变量重命名器（L0 纯变换，保护 uniform/in/out/struct 与内置符号）
'use strict';

const GLSL_RESERVED_IDS = new Set(
  (
    'attribute const uniform varying buffer shared coherent volatile restrict readonly writeonly layout centroid flat smooth noperspective patch sample ' +
    'break continue do for while switch case default if else subroutine in out inout invariant discard return struct precision highp mediump lowp true false void main ' +
    'float double int uint bool vec2 vec3 vec4 dvec2 dvec3 dvec4 bvec2 bvec3 bvec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 ' +
    'mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 ' +
    'dmat2 dmat3 dmat4 dmat2x2 dmat2x3 dmat2x4 dmat3x2 dmat3x3 dmat3x4 dmat4x2 dmat4x3 dmat4x4 ' +
    'sampler1D sampler2D sampler3D samplerCube sampler2DRect sampler1DShadow sampler2DShadow samplerCubeShadow sampler2DRectShadow ' +
    'sampler1DArray sampler2DArray sampler1DArrayShadow sampler2DArrayShadow samplerBuffer sampler2DMS sampler2DMSArray ' +
    'isampler1D isampler2D isampler3D isamplerCube isampler2DRect isampler1DArray isampler2DArray isamplerBuffer isampler2DMS isampler2DMSArray ' +
    'usampler1D usampler2D usampler3D usamplerCube usampler2DRect usampler1DArray usampler2DArray usamplerBuffer usampler2DMS usampler2DMSArray ' +
    'samplerCubeArray samplerCubeArrayShadow isamplerCubeArray usamplerCubeArray ' +
    'radians degrees sin cos tan asin acos atan sinh cosh tanh asinh acosh atanh pow exp log exp2 log2 sqrt inversesqrt ' +
    'abs sign floor trunc round roundEven ceil fract mod modf min max clamp mix step smoothstep isnan isinf ' +
    'floatBitsToInt floatBitsToUint intBitsToFloat uintBitsToFloat packSnorm2x16 unpackSnorm2x16 packUnorm2x16 unpackUnorm2x16 packHalf2x16 unpackHalf2x16 ' +
    'length distance dot cross normalize faceforward reflect refract matrixCompMult outerProduct transpose determinant inverse ' +
    'lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual any all not ' +
    'textureSize texture textureProj textureLod textureOffset texelFetch texelFetchOffset textureProjOffset textureLodOffset textureProjLod textureProjLodOffset ' +
    'textureGrad textureGradOffset textureProjGrad textureProjGradOffset dFdx dFdy fwidth'
  ).split(' ')
);
const GLSL_INTERFACE_QUALS = new Set(['uniform', 'in', 'out', 'varying', 'attribute', 'layout', 'buffer', 'shared']);
const GLSL_SHORT_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GLSL_SHORT_REST = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

function minifyGlsl(glsl) {
  let noComments = '';
  for (let i = 0; i < glsl.length; ) {
    if (glsl[i] === '/' && glsl[i + 1] === '/') {
      i += 2;
      while (i < glsl.length && glsl[i] !== '\n') i++;
      continue;
    }
    if (glsl[i] === '/' && glsl[i + 1] === '*') {
      i += 2;
      while (i < glsl.length && !(glsl[i] === '*' && glsl[i + 1] === '/')) i++;
      i += 2;
      noComments += ' ';
      continue;
    }
    noComments += glsl[i++];
  }
  const lines = noComments
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const res = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (line.startsWith('#')) {
      if (res.length > 0 && !res[res.length - 1].endsWith('\n')) res.push('\n');
      res.push(line + '\n');
    } else {
      res.push(
        line
          .replace(/\s+/g, ' ')
          .replace(/\s*([{}();,=*/<>?:])\s*/g, '$1')
          .replace(/\s*([+\-])\s*(?!\1)/g, '$1')
          .replace(/([+\-])\s+(?![+\-])/g, '$1')
          .replace(/(?<![\w.])(\d+\.\d*?[1-9])0+(?![\w.])/g, '$1')
          .replace(/(?<![\w.])(\d+)\.0+(?![\w.])/g, '$1.')
          .replace(/(?<![\w.])0(\.\d+)/g, '$1')
      );
    }
  }
  const compact = res.join('').trim();

  // Pass 1: Lex into preproc / num / id / ch tokens
  const tokens = [];
  const protectedIds = new Set();
  const allIds = new Set();
  const len = compact.length;
  for (let i = 0; i < len; ) {
    const ch = compact[i];
    if (ch === '#' && (i === 0 || compact[i - 1] === '\n')) {
      let j = i + 1;
      while (j < len && compact[j] !== '\n') j++;
      if (j < len && compact[j] === '\n') j++;
      const pre = compact.slice(i, j);
      tokens.push({ t: 'pre', v: pre });
      for (const m of pre.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
        protectedIds.add(m[0]);
        allIds.add(m[0]);
      }
      i = j;
      continue;
    }
    const c = compact.charCodeAt(i);
    if ((c >= 48 && c <= 57) || (ch === '.' && i + 1 < len && compact.charCodeAt(i + 1) >= 48 && compact.charCodeAt(i + 1) <= 57)) {
      const m = /^(?:0[xX][0-9a-fA-F]+|\d+\.\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|\d+(?:[eE][+-]?\d+)?)[uUfF]?/.exec(
        compact.slice(i)
      );
      if (m) {
        tokens.push({ t: 'num', v: m[0] });
        i += m[0].length;
        continue;
      }
    }
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) {
      let j = i + 1;
      while (j < len) {
        const cj = compact.charCodeAt(j);
        if ((cj >= 65 && cj <= 90) || (cj >= 97 && cj <= 122) || (cj >= 48 && cj <= 57) || cj === 95) j++;
        else break;
      }
      const id = compact.slice(i, j);
      tokens.push({ t: 'id', v: id });
      allIds.add(id);
      i = j;
      continue;
    }
    tokens.push({ t: 'ch', v: ch });
    i++;
  }

  // Pass 2: Collect protected identifiers (interface qualifiers, struct blocks/fields, dot members, reserved/gl_, and global fn / local var collisions)
  let braceDepth = 0;
  let parenDepth = 0;
  let stmtIds = [];
  let stmtHasInterface = false;
  let structPending = false;
  let protectedBlockDepth = -1;
  let prevSig = null;
  const topLevelFnNames = new Set();
  const localNonCallIds = new Set();

  const nextSigToken = (fromIdx) => {
    for (let k = fromIdx + 1; k < tokens.length; k++) {
      const ntk = tokens[k];
      if (ntk.t === 'pre') continue;
      if (ntk.t === 'ch' && (ntk.v === ' ' || ntk.v === '\n')) continue;
      return ntk;
    }
    return null;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'pre') continue;
    if (tk.t === 'ch' && (tk.v === ' ' || tk.v === '\n')) continue;

    if (tk.t === 'id') {
      const v = tk.v;
      const nextSig = nextSigToken(i);
      const isDotMember = Boolean(prevSig && prevSig.t === 'ch' && prevSig.v === '.');
      if (isDotMember) {
        protectedIds.add(v);
      }
      if (GLSL_RESERVED_IDS.has(v) || v.startsWith('gl_') || v.startsWith('__')) {
        protectedIds.add(v);
      }
      if (protectedBlockDepth >= 0 || structPending) {
        protectedIds.add(v);
      }
      if (v === 'struct') {
        structPending = true;
      }
      if (braceDepth === 0) {
        if (parenDepth === 0 && GLSL_INTERFACE_QUALS.has(v)) {
          stmtHasInterface = true;
        }
        if (parenDepth === 0 && prevSig && prevSig.t === 'id' && nextSig && nextSig.t === 'ch' && nextSig.v === '(' && !GLSL_RESERVED_IDS.has(v)) {
          topLevelFnNames.add(v);
        }
        stmtIds.push(v);
      } else if (!isDotMember && !(nextSig && nextSig.t === 'ch' && nextSig.v === '(') && !GLSL_RESERVED_IDS.has(v)) {
        localNonCallIds.add(v);
      }
    } else if (tk.t === 'ch') {
      if (tk.v === '{') {
        if (stmtHasInterface || structPending) {
          for (const sid of stmtIds) protectedIds.add(sid);
          if (protectedBlockDepth < 0) protectedBlockDepth = braceDepth;
        }
        braceDepth++;
        if (braceDepth === 1) {
          stmtIds = [];
          stmtHasInterface = false;
        }
      } else if (tk.v === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
        if (braceDepth === 0 && parenDepth === 0 && protectedBlockDepth < 0) {
          stmtIds = [];
          stmtHasInterface = false;
        }
      } else if (tk.v === '(') {
        parenDepth++;
      } else if (tk.v === ')') {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (tk.v === ';') {
        if (braceDepth === 0 && parenDepth === 0) {
          if (stmtHasInterface) {
            for (const sid of stmtIds) protectedIds.add(sid);
          }
          stmtIds = [];
          stmtHasInterface = false;
        }
        if (protectedBlockDepth >= 0 && braceDepth === protectedBlockDepth) {
          protectedBlockDepth = -1;
          structPending = false;
        } else if (structPending && protectedBlockDepth < 0) {
          structPending = false;
        }
      }
    }
    prevSig = tk;
  }

  for (const fnName of topLevelFnNames) {
    if (localNonCallIds.has(fnName)) {
      protectedIds.add(fnName);
    }
  }

  // Pass 3: Count local renameable identifiers and assign shortest collision-free names by savings
  const counts = new Map();
  prevSig = null;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'pre') continue;
    if (tk.t === 'ch' && (tk.v === ' ' || tk.v === '\n')) continue;
    if (tk.t === 'id' && !(prevSig && prevSig.t === 'ch' && prevSig.v === '.') && !protectedIds.has(tk.v) && tk.v.length >= 2) {
      counts.set(tk.v, (counts.get(tk.v) || 0) + 1);
    }
    prevSig = tk;
  }

  const candidates = Array.from(counts.entries()).sort((a, b) => {
    const saveDiff = (b[0].length - 1) * b[1] - (a[0].length - 1) * a[1];
    return saveDiff !== 0 ? saveDiff : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  });

  const usedNames = new Set([...protectedIds, ...allIds]);
  const renameMap = new Map();
  let seqIdx = 0;
  const nextShortName = () => {
    const cLen = GLSL_SHORT_CHARS.length;
    const rLen = GLSL_SHORT_REST.length;
    while (true) {
      let cand = '';
      if (seqIdx < cLen) {
        cand = GLSL_SHORT_CHARS[seqIdx];
      } else {
        const rem = seqIdx - cLen;
        const first = GLSL_SHORT_CHARS[Math.floor(rem / rLen) % cLen];
        const second = GLSL_SHORT_REST[rem % rLen];
        cand = rem < cLen * rLen ? first + second : first + second + String(Math.floor(rem / (cLen * rLen)));
      }
      seqIdx++;
      if (!usedNames.has(cand) && !GLSL_RESERVED_IDS.has(cand) && !cand.startsWith('gl_') && !cand.startsWith('__')) {
        usedNames.add(cand);
        return cand;
      }
    }
  };

  for (const [orig] of candidates) {
    const cand = nextShortName();
    if (cand.length < orig.length) {
      renameMap.set(orig, cand);
    }
  }

  if (renameMap.size === 0) return compact;

  // Pass 4: Emit renamed GLSL
  const out = [];
  prevSig = null;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (tk.t === 'pre') {
      out.push(tk.v);
      continue;
    }
    if (tk.t === 'ch' && (tk.v === ' ' || tk.v === '\n')) {
      out.push(tk.v);
      continue;
    }
    if (tk.t === 'id' && !(prevSig && prevSig.t === 'ch' && prevSig.v === '.') && renameMap.has(tk.v)) {
      out.push(renameMap.get(tk.v));
    } else {
      out.push(tk.v);
    }
    prevSig = tk;
  }
  return out.join('');
}

module.exports = {
  minifyGlsl,
};
