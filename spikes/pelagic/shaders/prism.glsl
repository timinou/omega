// Original live-set variation: folded chromatic architecture.
uniform float iBeat;
uniform float iZoom;
uniform float iIntensity;
uniform float iSymmetry;
uniform float iFeedback;
uniform float iPalette;
#define PI 3.14159265359
float edge(float d,float w){return w/(abs(d)+w);}
mat2 turn(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
vec3 ink(float p){return .55+.45*cos(6.28318*(vec3(.03,.28,.55)+p));}
void mainImage(out vec4 c,in vec2 coord){
 vec2 uv=(coord-.5*iResolution.xy)/iResolution.y;
 float low=iAudioBass,hit=iAudioOnset,mid=iAudioMid,t=iGlobalTime;
 vec2 p=turn(t*.06+floor(iBeat/16.)*.16)*uv*(1.-iZoom-low*.12);
 float r=length(p),a=atan(p.y,p.x),n=max(3.,iSymmetry);
 float fold=abs(mod(a+PI/n,2.*PI/n)-PI/n);
 vec2 k=r*vec2(cos(fold),sin(fold));
 vec3 light=vec3(0.);
 for(int j=0;j<8;j++){
  float f=float(j),z=fract(f/8.+t*.052),radius=.06+z*z*.88;
  float d=k.x-radius-.05*sin(k.y*13.+t*.4+f);
  vec3 col=ink(f*.105+t*.008+iPalette*.3);
  light+=col*pow(edge(d,.0016+.003*hit),1.7)*(.3+z)*(.3+low*1.8);
  light+=col*edge(k.y-k.x*(.22+.06*sin(t*.3+f)),.0012)*edge(r-radius,.025)*mid*1.3;
 }
 float spoke=edge(sin(a*n+sin(r*10.-t)*.18),.015)*smoothstep(.08,.3,r);
 light+=vec3(.05,.85,.9)*spoke*(.08+iAudioHigh*.45);
 light*=1.-smoothstep(.65,.95,r);
 light=1.-exp(-light*(iIntensity+.3));
 light=mix(light,texture2D(iChannel1,coord/iResolution.xy).rgb,clamp(iFeedback,0.,.6));
 c=vec4(light,1.);
}
