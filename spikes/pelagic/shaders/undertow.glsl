// Original live-set variation: interference printed on moving water.
uniform float iBeat;
uniform float iZoom;
uniform float iIntensity;
uniform float iFeedback;
uniform float iPalette;
mat2 turn(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
void mainImage(out vec4 c,in vec2 coord){
 vec2 uv=(coord-.5*iResolution.xy)/iResolution.y;
 float t=iGlobalTime,low=iAudioBass,mid=iAudioMid,hit=iAudioOnset;
 vec2 p=uv*(1.-iZoom-low*.1);
 vec2 q=turn(.35*sin(t*.07))*p;
 float bend=.09*sin(q.x*7.+t*.3)+.07*sin(q.x*12.-t*.18);
 float carrier=sin((q.y+bend)*110.+t*.8);
 vec2 v=turn(-.22+t*.012)*p;
 float cross=sin((v.y+.06*sin(v.x*11.+t*.2))*104.-t*.7);
 float printA=pow(max(0.,carrier),14.);
 float printB=pow(max(0.,cross),14.);
 float envelope=.28+.72*exp(-abs(p.y)*1.6);
 vec3 light=vec3(.04,.86,.83)*printA*(.18+mid)*envelope;
 light+=vec3(1.,.18,.3)*printB*(.1+low*.9)*envelope;
 float ripples=pow(max(0.,sin(length(p)*86.-t*2.-low*5.)),28.);
 light+=vec3(.6,.3,1.)*ripples*hit*.3;
 light*=1.-smoothstep(.35,1.,length(p));
 light=1.-exp(-light*(iIntensity+1.));
 light=mix(light,light.brg,clamp(iPalette,0.,1.));
 light=mix(light,texture2D(iChannel1,coord/iResolution.xy).rgb,clamp(iFeedback,0.,.6));
 c=vec4(light,1.);
}
