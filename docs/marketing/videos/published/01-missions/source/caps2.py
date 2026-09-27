import json
from caps import TEXT, chunk
wt=json.load(open("wordtimes.json",encoding="utf-8"))
vp=json.load(open("vplan.json",encoding="utf-8"))
FPS=30;SP=1.2
CARDS=[("A","50 כדורי פלאפל"),("C","פרס מעל 1,000 ₪"),("G","22.10"),("H","2 מתוך 10")]
states=[]      # {t0,t1,words,active}
for s in vp["segs"]:
    w=wt[s["id"]]; words=w["words"]; times=w["times"]; sizes=w["chunks"]
    i=0
    for n in sizes:
        grp=words[i:i+n]; gt=times[i:i+n]
        for k in range(n):
            a=gt[k][0]; b=gt[k][1] if k<n-1 else gt[-1][1]
            b=max(b,a+0.08)
            if k<n-1: b=gt[k+1][0]           # hold until the next word starts
            states.append(dict(t0=round(a,3),t1=round(b,3),words=grp,active=k))
        i+=n
# close gaps inside a chunk so the line never blinks out
states.sort(key=lambda x:x["t0"])
for j in range(len(states)-1):
    gap=states[j+1]["t0"]-states[j]["t1"]
    if gap>0 and gap<=0.60:                 # bridge short gaps, keep real pauses clear
        states[j]["t1"]=states[j+1]["t0"]
cards=[]
for sid,label in CARDS:
    seg=[x for x in vp["segs"] if x["id"]==sid][0]
    a=seg["f0"]/FPS/SP; b=seg["f1"]/FPS/SP
    cards.append(dict(t0=round(a+0.12,3),t1=round(min(b,a+2.6),3),text=label))
json.dump(dict(states=states,cards=cards),open("captions2.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
print(f"{len(states)} word states, {len(cards)} cards, ends {states[-1]['t1']:.2f}s")
for x in states[:6]: print(f"  {x['t0']:6.2f}-{x['t1']:6.2f} [{x['active']}] {' '.join(x['words'])}")
