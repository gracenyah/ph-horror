#!/usr/bin/env python3
"""Check the static site and, when requested, the actual exported game."""
from pathlib import Path
from html.parser import HTMLParser
from urllib.parse import urlsplit, unquote
import argparse, json, re, hashlib

ROOT=Path(__file__).resolve().parents[1]
DEFAULT_SCENES=['Level01_Rumuola','Level02_Slaughter','Level03_FloodedMile','Level04_NO18','Level05_Rumuokoro']
class Page(HTMLParser):
    def __init__(self): super().__init__(); self.ids=[]; self.refs=[]
    def handle_starttag(self, tag, attrs):
        a=dict(attrs)
        if 'id' in a:self.ids.append(a['id'])
        for key in ('src','href'):
            if key in a:self.refs.append(a[key])

def asset_path(root,url):
    parsed=urlsplit(url)
    if parsed.scheme or parsed.netloc:return None
    if parsed.path.startswith('/'):raise ValueError('Root-absolute asset URL will break under /play/: '+url)
    target=(root/unquote(parsed.path)).resolve()
    if not target.is_relative_to(root.resolve()):raise ValueError('Asset path escapes game directory: '+url)
    return target

def inspect_game(root):
    root=Path(root)
    if not (root/'index.html').is_file():raise ValueError('The exported game index.html is missing.')
    configs=list(root.glob('*config*.json'))
    config_path=next((p for p in configs if p.name=='config.json'),None)
    if not config_path:raise ValueError('No PlayCanvas config.json found. Supply a downloaded web build, not the source project.')
    config=json.loads(config_path.read_text()); scenes=config.get('scenes',[])
    if isinstance(scenes,dict):scenes=list(scenes.values())
    chapters=[]
    for n in range(1,6):
        found=[s for s in scenes if re.match(rf'^Level0?{n}(?=[_ A-Za-z-]|$)',s.get('name',''),re.I)]
        if len(found)!=1:raise ValueError(f'Expected one exported Level {n} scene; found {len(found)}. Include all five scenes and retain Level01_... names.')
        chapters.append(found[0])
    settings=list(root.glob('*settings*.js'))
    entry=None
    for settings_path in settings:
        match=re.search(r'SCENE_PATH\s*=\s*[\'"]([^\'"]+)',settings_path.read_text())
        if match:entry=match.group(1);break
    if not entry:raise ValueError('Cannot identify the initial SCENE_PATH in the exported settings file.')
    if unquote(urlsplit(entry).path).lstrip('./')!=unquote(urlsplit(chapters[0]['url']).path).lstrip('./'):raise ValueError('Set Level 1 as the first/export entry scene before downloading the web build.')
    assets=config.get('assets',{});names=[s['name'] for s in chapters]
    for asset in assets.values():
        url=(asset.get('file') or {}).get('url')
        if url:
            target=asset_path(root,url)
            if target is not None and not target.is_file():raise ValueError('Missing exported asset: '+url)
    for chapter in chapters:
        scene_path=asset_path(root,chapter['url'])
        if scene_path is None or not scene_path.is_file():raise ValueError('Missing chapter file: '+chapter['url'])
        scene=json.loads(scene_path.read_text()); entities=scene.get('entities',{}); controllers=[];scripts=[]
        def enabled(entity):
            seen=set()
            while entity:
                if entity.get('enabled',True) is False:return False
                parent=entity.get('parent')
                if not parent or parent in seen:break
                seen.add(parent);entity=entities.get(parent)
            return True
        for entity in entities.values():
            component=(entity.get('components') or {}).get('script',{})
            if not enabled(entity) or component.get('enabled',True) is False:continue
            for name,script in component.get('scripts',{}).items():
                if script.get('enabled',True) is False:continue
                attributes=script.get('attributes',{})
                if name in ('developerJumpMenu','level05DeveloperMenu') and attributes.get('devMenuEnabled',True) is not False:raise ValueError(chapter['name']+': disable the developer menu before exporting.')
                if name=='releaseLaunchController' and attributes.get('releaseMode',True) is not False:
                    if not component.get('order') or component['order'][0]!=name:raise ValueError(chapter['name']+': releaseLaunchController must be FIRST on Systems.')
                    controllers.append(attributes)
                scripts.append((name,attributes))
        if len(controllers)!=1:raise ValueError(chapter['name']+': add exactly one enabled releaseLaunchController.')
        for n,actual in enumerate(names,1):
            configured=controllers[0].get(f'level0{n}Scene',DEFAULT_SCENES[n-1])
            if configured!=actual:raise ValueError(chapter['name']+f': Release Controller Level {n} Scene is {configured!r}, but the export contains {actual!r}.')
        for name,attributes in scripts:
            required={'level04VanishedCity':['voiceAtlas'],'level05ConvoyInvestigation':['voiceAtlas','endingAudio']}.get(name,[])
            for field in required:
                asset_id=attributes.get(field);asset=assets.get(str(asset_id))
                if not asset or asset.get('type')!='audio':raise ValueError(f'{chapter["name"]}: assign the {name}.{field} audio asset before exporting.')
    return {'chapters':names,'entry':entry,'configSha256':hashlib.sha256(config_path.read_bytes()).hexdigest()}

def inspect_site(require_game=False):
    page=Page();page.feed((ROOT/'index.html').read_text())
    if len(page.ids)!=len(set(page.ids)):raise ValueError('Duplicate HTML IDs on the landing page.')
    for ref in page.refs:
        if ref.startswith('#'):
            if ref[1:] and ref[1:] not in page.ids:raise ValueError('Broken page anchor: '+ref)
        elif not urlsplit(ref).scheme and not ref.startswith('//'):
            path=unquote(urlsplit(ref).path)
            if path and not path.endswith('/') and not (ROOT/path).exists():raise ValueError('Missing website file: '+path)
    if require_game:
        info=inspect_game(ROOT/'play');marker=json.loads((ROOT/'play/release-ready.json').read_text())
        if marker.get('ready') is not True or marker.get('chapters')!=info['chapters'] or marker.get('configSha256')!=info['configSha256']:raise ValueError('Game readiness marker is missing or stale; import the checked export again.')
        return info
    return {'website':'checked','game':'not verified; export still required'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--require-game',action='store_true');args=parser.parse_args()
    try:print(json.dumps(inspect_site(args.require_game),indent=2))
    except (ValueError,KeyError,OSError,json.JSONDecodeError) as e:parser.exit(1,'Release check failed: '+str(e)+'\n')
