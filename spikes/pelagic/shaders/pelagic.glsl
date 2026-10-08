// PELAGIC / CURRENT CLUB — original audio-reactive vector light choreography.
// Geometry is driven by measured sound. The transport only chooses/edit-cuts scenes.
uniform float iBeat;
uniform float iScene;
uniform float iEnergy;
uniform float iAccent;
#define PI 3.14159265359
mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float line(float d,float width){return width/(abs(d)+width);}
vec3 spectrum(float x){return .55+.45*cos(6.28318*(vec3(.03,.23,.53)+x));}
float box(vec2 p,vec2 s){vec2 q=abs(p)-s;return length(max(q,0.))+min(max(q.x,q.y),0.);}
void mainImage(out vec4 fragColor,in vec2 fragCoord){
 vec2 uv=(fragCoord-.5*iResolution.xy)/iResolution.y;
 float t=iGlobalTime,b=iBeat;
 float bass=iAudioBass,mid=iAudioMid,hi=iAudioHigh,hit=iAudioOnset;
 float sound=clamp(iOvertoneVolume*9.,0.,1.);
 // Exactly one of four visual languages, with slow crossfades around act changes.
 float scene=clamp(iScene,0.,3.);
 float w0=1.-smoothstep(.65,1.,scene);
 float w2=smoothstep(1.65,2.,scene)*(1.-smoothstep(2.65,3.,scene));
 float w3=smoothstep(2.65,3.,scene),w1=1.-w0-w2-w3;
 float cut=floor(b/16.);
 float turn=mod(cut,4.)*PI*.5;
 // Beat clock arranges cuts; the camera punch requires actual bass/onset energy.
 vec2 p=rot(turn+.035*sin(t*.2))*(uv*(1.-.16*bass)-vec2(hit*.018,0.));
 float r=length(p),a=atan(p.y,p.x);
 vec3 cyan=vec3(.05,.95,.86),hot=vec3(1.,.16,.32),gold=vec3(1.,.68,.16);
 vec3 violet=vec3(.52,.22,1.);
 vec3 color=vec3(.003,.008,.018);
 // I. Bathymetry: engraved topographic interference, then ripples from the kick.
 vec2 q=p+vec2(.18*sin(t*.12),.1*cos(t*.16));
 float dist=length(q*vec2(1.,1.22));
 float terrain=dist+.05*sin(q.x*8.+t*.24)*sin(q.y*7.-t*.18);
 float contour=abs(fract(terrain*(13.+bass*4.)-t*.16)-.5);
 vec3 opening=cyan*pow(line(contour,.014+.013*mid),2.)*(.16+.8*sound);
 opening+=spectrum(a/6.28+t*.014)*line(dist-(.18+bass*.23),.003)*(.4+bass);
 opening+=hot*line(q.y-.09*sin(q.x*12.+t+mid*5.),.0018)*(.12+mid);
 color+=opening*w0;
 // II. Current: a perspective tunnel of offset, alternating cyan/coral portals.
 // Different widths and broken segments give a club-video rhythm, rather than a screensaver orbit.
 vec3 tunnel=vec3(0.);
 for(int j=0;j<12;j++){
  float fj=float(j),z=fract(fj/12.+t*.105),scale=.07+z*z*1.9;
  vec2 v=rot(.18*sin(t*.28+fj*.35)+.16*bass*sin(fj))*p;
  float d=box(v,vec2(scale,scale*.62));
  float edge=line(d,.0015+.0025*z+.004*hit);
  float segments=.35+.65*step(-.15,sin(atan(v.y,v.x)*6.+fj+floor(b/2.)));
  vec3 ink=mix(cyan,hot,step(.5,fract(fj*.5)));
  tunnel+=ink*pow(edge,1.7)*z*(.55+bass*1.4)*segments;
  // Broad planes refract the kick; restrained filled regions preserve contrast.
  tunnel+=ink*exp(-abs(d)*35.)*.045*z*bass;
 }
 vec2 rails=vec2(abs(p.x),abs(p.y));
 tunnel+=gold*line(rails.y-.19-.35*rails.x,.0018)*(.2+hi*1.7);
 color+=tunnel*w1;
 // III. Cathedral: a kinetic, folded light mandala with spectral petal edges.
 // Every four bars the symmetry flips between six and eight, with an eight-beat iris.
 float petals=mix(6.,8.,mod(cut,2.));
 float fold=abs(mod(a+PI/petals+floor(b/8.)*.12,2.*PI/petals)-PI/petals);
 vec2 k=vec2(cos(fold),sin(fold))*r;
 vec3 cathedral=vec3(0.);
 for(int j=0;j<7;j++){
  float fj=float(j),rr=.10+fj*.092+bass*.085;
  float petal=rr+(.055+.06*mid)*cos(a*petals+t*.32+fj*.8);
  float edge=line(r-petal,.0018+.002*hit);
  vec3 ink=mix(gold,hot,.5+.5*sin(fj*.7+t*.1));
  cathedral+=ink*pow(edge,1.6)*(.3+sound+mid*.8);
  float blade=box(rot(.42+sin(t*.3+fj)*.14)*vec2(k.x-rr,k.y),vec2(.05+mid*.035,.006+hi*.006));
  cathedral+=spectrum(fj*.11+t*.01)*line(blade,.0018)*(.3+mid);
 }
 cathedral+=cyan*line(k.y-k.x*.12,.0015)*smoothstep(.12,.35,r)*(1.-smoothstep(.65,.85,r))*(.2+hi*2.);
 color+=cathedral*w2;
 // IV. Afterglow: violet ribbon echoes. A late reprise tightens the ribbons again.
 vec3 after=vec3(0.);
 for(int j=0;j<9;j++){
  float fj=float(j),phase=t*.3+fj*.36;
  float ribbon=p.y-.25*sin(p.x*(3.+bass*2.)+phase)-.032*(fj-4.);
  after+=mix(violet,cyan,fj/10.)*pow(line(ribbon,.0025+.003*mid),1.8)*(.25+sound);
 }
 after+=hot*line(r-(.28+.13*sin(a*3.+t*.3)+bass*.08),.002)*(.2+mid);
 color+=after*w3;
 // Audible frequencies become a segmented radial spectrogram, not a decorative clock.
 float band=texture2D(iChannel0,vec2(.002+pow(abs(a)/PI,2.)*.35,.25)).r;
 float ring=.43+.15*band;
 float dashed=step(.25,fract(a*36./PI));
 color+=mix(cyan,gold,w2)*line(r-ring,.0015)*dashed*sound*.48;
 // Treble reveals tiny indexed tiles and point-like sparks; silence removes both.
 vec2 cell=floor((p+1.)*48.);
 vec2 local=fract((p+1.)*48.)-.5;
 float seed=hash(cell+floor(b*2.));
 float sparks=step(1.-hi*.055,seed)*pow(max(0.,1.-length(local)*2.),7.);
 color+=vec3(.7,.94,1.)*sparks*hi*3.;
 // A measured onset opens four corner brackets instead of washing out the whole frame.
 vec2 corner=abs(uv)-vec2(.77,.38);
 float bracket=min(abs(corner.x)+max(0.,abs(corner.y)-.035),abs(corner.y)+max(0.,abs(corner.x)-.035));
 color+=hot*line(bracket,.0012)*hit*2.;
 // Filmic contrast and dark margins; no automatic full-screen strobe.
 color*=1.-.45*smoothstep(.35,1.1,r);
 color=1.-exp(-color*1.35);
 color=pow(max(color,0.),vec3(.9));
 color+=(hash(fragCoord+floor(t*24.))-.5)*.004;
 fragColor=vec4(color,1.);
}
