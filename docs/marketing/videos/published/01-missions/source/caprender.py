import os
from PIL import Image,ImageDraw,ImageFont,ImageFilter
from bidi.algorithm import get_display
FONT=os.path.expanduser("~/.claude/toolkits/video-editing/fonts/Rubik.ttf")
W,H=1080,1920
ORANGE=(255,87,34); AMBER=(255,179,0); WHITE=(255,255,255)
SUB_Y=0.630; CARD_Y=0.515
SUB_MAX=96; SUB_MIN=52; CARD_MAX=104; CARD_MIN=58
MARGIN=54                      # hard left/right margin, nothing may cross it
_D=ImageDraw.Draw(Image.new("RGB",(8,8)))
def _f(sz):
    f=ImageFont.truetype(FONT,sz)
    try: f.set_variation_by_name("Bold")
    except Exception: pass
    return f
def _fit(parts,maxw,start,minsz):
    """parts = list of visual strings joined by a space"""
    sz=start
    while sz>minsz:
        f=_f(sz)
        if _D.textlength(" ".join(parts),font=f)<=maxw: return f
        sz-=2
    return _f(minsz)
def _bounds_ok(x,y,w,h,who):
    assert x>=0 and y>=0 and x+w<=W and y+h<=H, \
f"{who} out of frame: x{x:.0f} y{y:.0f} w{w:.0f} h{h:.0f}"
def sub_layer(words,active=-1):
    """RTL line; the word at index `active` (in reading order) is amber."""
    vis=[get_display(w) for w in reversed(words)]
    n=len(vis); a_vis = (n-1-active) if 0<=active<n else -1
    f=_fit(vis,W-2*MARGIN,SUB_MAX,SUB_MIN)
    total=_D.textlength(" ".join(vis),font=f)
    asc,desc=f.getmetrics(); th=asc+desc
    x=(W-total)/2; y=H*SUB_Y
    assert x>=MARGIN-1 and x+total<=W-MARGIN+1, f"sub overflows: {x:.0f}..{x+total:.0f}"
    assert y+th<=H, "sub below frame"
    # soft dark halo so the line survives bright, busy b-roll backgrounds
    halo=Image.new("L",(W,H),0); hd=ImageDraw.Draw(halo)
    cx=x
    for wv in vis:
        hd.text((cx,y),wv,font=f,fill=255); cx+=_D.textlength(wv,font=f)+_D.textlength(" ",font=f)
    halo=halo.filter(ImageFilter.GaussianBlur(20)).point(lambda v:min(255,int(v*2.2)))
    img=Image.new("RGBA",(W,H),(0,0,0,0))
    img.paste((0,0,0,255),(0,0),halo.point(lambda v:int(v*0.62)))
    d=ImageDraw.Draw(img)
    cx=x
    for i,wv in enumerate(vis):
        wl=_D.textlength(wv,font=f)
        for dx in range(-6,7,2):
            for dy in range(-6,7,2):
                if dx or dy: d.text((cx+dx,y+dy),wv,font=f,fill=(0,0,0,220))
        d.text((cx,y),wv,font=f,fill=(AMBER if i==a_vis else WHITE)+(255,))
        cx+=wl+_D.textlength(" ",font=f)
    return img
def card_layer(txt):
    t=get_display(txt)
    f=_fit([t],W-2*MARGIN-92,CARD_MAX,CARD_MIN)
    tw=_D.textlength(t,font=f); asc,desc=f.getmetrics(); th=asc+desc
    px,py=44,20; x=(W-tw)/2; y=H*CARD_Y
    assert x-px>=0 and x+tw+px<=W, "card overflows width"
    assert y+th+py<=H*SUB_Y-8, f"card would touch the subtitle (ends {y+th+py:.0f}, sub starts {H*SUB_Y:.0f})"
    img=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(img)
    d.rounded_rectangle([x-px,y-py,x+tw+px,y+th+py],radius=26,fill=ORANGE+(243,))
    d.text((x,y),t,font=f,fill=WHITE+(255,))
    return img
