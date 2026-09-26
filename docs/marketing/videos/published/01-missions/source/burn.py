import os,sys,json,cv2,numpy as np,subprocess
os.chdir(os.path.dirname(os.path.abspath(__file__)))
from caprender import sub_layer,card_layer
SRC=sys.argv[1]; OUT=sys.argv[2]; FPS=30
C=json.load(open("captions2.json",encoding="utf-8"))
def prep(layer):
    a=np.array(layer).astype(np.float32)
    ys,xs=np.where(a[:,:,3]>0)
    if len(ys)==0: return None
    y0,y1,x0,x1=int(ys.min()),int(ys.max())+1,int(xs.min()),int(xs.max())+1
    return dict(rgb=a[y0:y1,x0:x1,:3][:,:,::-1].copy(),al=a[y0:y1,x0:x1,3:4]/255.0,
                y0=y0,y1=y1,x0=x0,x1=x1)
subs=[dict(t0=s["t0"],t1=s["t1"],L=prep(sub_layer(s["words"],s["active"]))) for s in C["states"]]
GFX=json.load(open("gfx.json")) if os.path.exists("gfx.json") else []
def clip(a,b):
    """Trim an emphasis card so it never runs under a full screen graphic."""
    for g0,g1 in GFX:
        if a>=g0 and b<=g1: return None          # wholly inside: drop it
        if g0<b<=g1: b=g0                        # runs into one: end before it
        elif g0<=a<g1: a=g1                      # starts inside one: start after
    return (a,b) if b-a>0.25 else None
cards=[]
for c in C["cards"]:
    w=clip(c["t0"],c["t1"])
    if w is None:
        print(f"  card dropped (full screen graphic covers it): {c['text']}",flush=True)
        continue
    if (w[0],w[1])!=(c["t0"],c["t1"]):
        print(f"  card clipped {c['t0']:.2f}-{c['t1']:.2f} -> {w[0]:.2f}-{w[1]:.2f}: {c['text']}",flush=True)
    cards.append(dict(t0=w[0],t1=w[1],L=prep(card_layer(c["text"]))))
print(f"prerendered {len(subs)} word states + {len(cards)} cards",flush=True)
cap=cv2.VideoCapture(SRC)
W=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH));H=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
N=int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
p=subprocess.Popen(["ffmpeg","-y","-loglevel","error","-f","rawvideo","-pix_fmt","bgr24",
 "-s",f"{W}x{H}","-r","30","-i","-","-an","-c:v","libx264","-preset","slow","-crf","20",
 "-pix_fmt","yuv420p",OUT],stdin=subprocess.PIPE)
def scrim(fr,L,pad=48,strength=0.74):
    """Darken a lane behind the subtitle while a full screen GRAPHIC is showing.

    The subtitle has to be on every frame, and the graphics fill the frame, so
    the two land on each other: the mission list's highlighted row and the
    board's seventh slot both sat directly under the words. Legibility was never
    the problem, the halo handled that; it read as text on text. A soft lane
    makes the subtitle an overlay again. Not applied over faces or footage,
    where there is nothing underneath to separate from.
    """
    if L is None: return fr
    y0=max(0,L["y0"]-pad); y1=min(fr.shape[0],L["y1"]+pad); h=y1-y0
    if h<8: return fr
    k=max(1,h//3)
    a=np.concatenate([np.linspace(0,1,k),np.ones(h-2*k),np.linspace(1,0,k)])[:h]
    a=(a*strength).astype(np.float32)[:,None,None]
    fr[y0:y1]=(fr[y0:y1].astype(np.float32)*(1-a)).astype(np.uint8)
    return fr
def in_gfx(t):
    return any(g0<=t<g1 for g0,g1 in GFX)
def put(fr,L,f=1.0):
    if L is None: return fr
    y0,y1,x0,x1=L["y0"],L["y1"],L["x0"],L["x1"]
    reg=fr[y0:y1,x0:x1].astype(np.float32); a=L["al"]*f
    fr[y0:y1,x0:x1]=(reg*(1-a)+L["rgb"]*a).astype(np.uint8); return fr
i=0
while True:
    ok,fr=cap.read()
    if not ok: break
    t=i/FPS
    for s in subs:
        if s["t0"]<=t<s["t1"]:
            if in_gfx(t): fr=scrim(fr,s["L"])
            fr=put(fr,s["L"]); break
    for c in cards:
        if c["t0"]<=t<c["t1"]:
            f=min(1.0,(t-c["t0"])/0.14,(c["t1"]-t)/0.20); fr=put(fr,c["L"],max(0,f)); break
    p.stdin.write(fr.tobytes()); i+=1
    if i%400==0: print(f"  burn {i}/{N}",flush=True)
p.stdin.close(); p.wait(); cap.release(); print(f"BURNED {i} -> {OUT}")
