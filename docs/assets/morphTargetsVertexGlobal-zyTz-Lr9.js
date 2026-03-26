import{p as e}from"./math.scalar.functions-PeE1O4gN.js";import{t}from"./shaderStore-1xgJNigV.js";var n=e({morphTargetsVertexGlobal:()=>a}),r=`morphTargetsVertexGlobal`,i=`#ifdef MORPHTARGETS
#ifdef MORPHTARGETS_TEXTURE
float vertexID;
#endif
#endif
`;t.IncludesShadersStore[r]||(t.IncludesShadersStore[r]=i);var a={name:r,shader:i};export{n as t};