import{t as e}from"./shaderStore-1xgJNigV.js";var t=`fogVertex`,n=`#ifdef FOG
vFogDistance=(view*worldPos).xyz;
#endif
`;e.IncludesShadersStore[t]||(e.IncludesShadersStore[t]=n);