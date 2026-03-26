import{p as e}from"./math.scalar.functions-PeE1O4gN.js";import{t}from"./shaderStore-1xgJNigV.js";import"./helperFunctions-R66j0dBE.js";var n=e({rgbdEncodePixelShader:()=>a}),r=`rgbdEncodePixelShader`,i=`varying vec2 vUV;uniform sampler2D textureSampler;
#include<helperFunctions>
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) 
{gl_FragColor=toRGBD(texture2D(textureSampler,vUV).rgb);}`;t.ShadersStore[r]||(t.ShadersStore[r]=i);var a={name:r,shader:i};export{n as t};