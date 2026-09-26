import json,numpy as np,soundfile as sf,librosa
SR=48000;FPS=30
vp=json.load(open("vplan.json",encoding="utf-8"))
cuts={c["id"]:c for c in json.load(open("cutlist.json",encoding="utf-8"))}
GAIN={0:0.0}
src={}
y=librosa.load("mic.m4a",sr=SR,mono=False)[0]
src[0]=y if y.ndim>1 else np.stack([y,y])
TOTN=vp["total_frames"]/FPS
# --- continuous room tone bed from real take-2 silence, tiled with crossfades
rt=src[0][:,int(70.5*SR):int(75.5*SR)].copy()
L=rt.shape[1]; xf=int(0.25*SR); r=np.linspace(0,1,xf)
bed=np.zeros((2,int(TOTN*SR)+SR))
p=0
while p<bed.shape[1]-L:
    seg=rt.copy(); seg[:,:xf]*=r; seg[:,-xf:]*=r[::-1]
    bed[:,p:p+L]+=seg; p+=L-xf
bed=bed[:,:int(round(TOTN*SR))]
# --- speech laid into exact frame slots, fading into the bed not into silence
sp=np.zeros_like(bed); FADE=int(0.070*SR); ramp=np.linspace(0,1,FADE)
pos=0
for s in vp["segs"]:
    c=cuts[s["id"]]; slot=int(round(s["frames"]/FPS*SR))
    n=int(round((c["b"]-c["a"])*SR))
    y=src[0][:,int(round(c["a"]*SR)):int(round(c["a"]*SR))+n]*(10**(GAIN[0]/20))
    y=y.copy(); y[:,:FADE]*=ramp; y[:,-FADE:]*=ramp[::-1]
    n=min(n,slot); sp[:,pos:pos+n]+=y[:,:n]; pos+=slot
out=sp+bed*0.85
sf.write("vo_raw.wav",out.T,SR)
print(f"natural VO {out.shape[1]/SR:.3f}s (target {TOTN:.3f}s)  bed tiled, 70ms speech fades")
