#!/usr/bin/env python3
"""Import only a valid five-scene web export; never overwrite the marketing site."""
from pathlib import Path, PurePosixPath
import argparse, hashlib, json, shutil, stat, tempfile, zipfile
from check_site import inspect_game, ROOT

def import_build(archive):
    archive=Path(archive)
    with tempfile.TemporaryDirectory(prefix='lostcity-export-') as temporary:
        staging=Path(temporary)
        with zipfile.ZipFile(archive) as z:
            if len(z.infolist())>20000 or sum(i.file_size for i in z.infolist())>750*1024*1024:raise ValueError('Export is too large for this release importer.')
            for item in z.infolist():
                path=PurePosixPath(item.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in item.filename or stat.S_ISLNK(item.external_attr>>16):raise ValueError('Unsafe archive entry: '+item.filename)
                if '.git' in path.parts:raise ValueError('Supply the game web export, not a source repository ZIP.')
            z.extractall(staging)
        roots=[p.parent for p in staging.rglob('index.html') if (p.parent/'config.json').is_file()]
        if len(roots)!=1:raise ValueError('Expected one PlayCanvas index.html with config.json in the web export.')
        source=roots[0];info=inspect_game(source)
        # Keep the old imported build as a local backup, outside the public directory.
        destination=ROOT/'play'
        if destination.exists() and any(p.name!='release-ready.json' for p in destination.iterdir()):
            backup=ROOT.parent/'game-build-backups';backup.mkdir(exist_ok=True);name='play-'+hashlib.sha256(archive.read_bytes()).hexdigest()[:12]
            if (backup/name).exists():raise ValueError('This export was already imported; inspect the existing backup before replacing again.')
            shutil.move(str(destination),str(backup/name))
        destination.mkdir(exist_ok=True);shutil.copytree(source,destination,dirs_exist_ok=True)
        marker={'ready':True,**info,'sourceZipSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'assetRights':'Current Mac voices retained at user request; public-use rights not cleared.'}
        (destination/'release-ready.json').write_text(json.dumps(marker,indent=2)+'\n')
        print(json.dumps(marker,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('web_build_zip',help='ZIP downloaded using PlayCanvas Publishing > Download .ZIP');args=parser.parse_args()
    try:import_build(args.web_build_zip)
    except (ValueError,OSError,zipfile.BadZipFile,KeyError,json.JSONDecodeError) as e:parser.exit(1,'Import stopped: '+str(e)+'\n')
