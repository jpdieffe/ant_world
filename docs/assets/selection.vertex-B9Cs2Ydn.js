import{t as e}from"./shaderStore-1xgJNigV.js";import"./clipPlaneVertexDeclaration-BIy72R5Q.js";import"./clipPlaneVertex-DaqhPhHy.js";import"./bonesDeclaration-Davuocyt.js";import"./bakedVertexAnimation-xsJQ4SE5.js";import"./morphTargetsVertexGlobalDeclaration-DuZhZbKk.js";import"./morphTargetsVertexDeclaration-BoGziE-a.js";import"./instancesDeclaration-3GT--0ZP.js";import"./morphTargetsVertexGlobal-zyTz-Lr9.js";import"./morphTargetsVertex-DhICa0d8.js";import"./instancesVertex-ClGfmwuT.js";import"./bonesVertex-Bwa8FPnW.js";var t=`selectionVertexShader`,n=`attribute vec3 position;
#ifdef INSTANCES
attribute float instanceSelectionId;
#endif
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
#include<instancesDeclaration>
uniform mat4 viewProjection;
#ifdef STORE_CAMERASPACE_Z
uniform mat4 view;
#else
uniform vec2 depthValues;
#endif
#ifdef INSTANCES
flat varying float vSelectionId;
#endif
#ifdef STORE_CAMERASPACE_Z
varying float vViewPosZ;
#else
varying float vDepthMetric;
#endif
#ifdef ALPHATEST
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#define CUSTOM_VERTEX_DEFINITIONS
void main(void) {
#define CUSTOM_VERTEX_MAIN_BEGIN
vec3 positionUpdated=position;
#ifdef UV1
vec2 uvUpdated=uv;
#endif
#ifdef UV2
vec2 uv2Updated=uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);gl_Position=viewProjection*worldPos;
#ifdef ALPHATEST
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
#ifdef STORE_CAMERASPACE_Z
vViewPosZ=(view*worldPos).z;
#else
#ifdef USE_REVERSE_DEPTHBUFFER
vDepthMetric=((-gl_Position.z+depthValues.x)/(depthValues.y));
#else
vDepthMetric=((gl_Position.z+depthValues.x)/(depthValues.y));
#endif
#endif
#ifdef INSTANCES
vSelectionId=instanceSelectionId;
#endif
#include<clipPlaneVertex>
#define CUSTOM_VERTEX_MAIN_END
}
`;e.ShadersStore[t]||(e.ShadersStore[t]=n);var r={name:t,shader:n};export{r as selectionVertexShader};