#!/usr/bin/env python3
"""Apply the reviewed source cleanup fixes to an existing PlayCanvas web export."""
from pathlib import Path
import argparse
import hashlib
import json
import re

BUILD = 'handoff-20261027-02'
MARKER = '\n/* LOST_CITY_SCENE_HANDOFF_REPAIR */\n'
BOOT_MARKER = '\n/* LOST_CITY_CHAPTER_BOOT_RESUME */\n'
SOURCE = Path(__file__).resolve().parents[2] / 'playcanvas-integration'


def method(filename, classname, name):
    source = (SOURCE / filename).read_text()
    start = source.index(classname + '.prototype.' + name)
    end = source.index('\n};', start) + len('\n};')
    return source[start:end]


def patch(root):
    root = Path(root)
    bundle = root / '__game-scripts.js'
    code = bundle.read_text().split(MARKER)[0].rstrip()
    overrides = [
        method('Level04ServiceChamber.js', 'Level04ServiceChamber', '_cleanup'),
        method('Level04StreetEscape.js', 'Level04StreetEscape', '_connectScene'),
        method('Level04StreetEscape.js', 'Level04StreetEscape', '_cleanup'),
    ]
    bundle.write_text(code + MARKER + '\n'.join(overrides)
                      + '\nwindow.__lostCityReleaseBuild = ' + json.dumps(BUILD) + ';\n')

    config_path = root / 'config.json'
    config = json.loads(config_path.read_text())
    content = bundle.read_bytes()
    for asset in config['assets'].values():
        file = asset.get('file') or {}
        if file.get('url') == '__game-scripts.js':
            file['size'] = len(content)
            file['hash'] = hashlib.md5(content).hexdigest()
    config_path.write_text(json.dumps(config, separators=(',', ':')))

    # Select the saved chapter before constructing a scene. Refresh no longer
    # creates and destroys Level 1 just to reach the player's saved chapter.
    chapters = {}
    chapter_names = {}
    for scene in config['scenes']:
        match = re.match(r'^Level0?([1-5])(?=[_ A-Za-z-]|$)', scene['name'], re.I)
        if match:
            chapters[int(match.group(1))] = scene['url']
            chapter_names[int(match.group(1))] = scene['name']
    settings = root / '__settings__.js'
    boot = settings.read_text().split(BOOT_MARKER)[0].rstrip()
    boot += BOOT_MARKER + '(function () {\n'
    boot += '    try {\n'
    boot += '        var chapter = Number(window.localStorage.getItem("lostcity:release:chapter"));\n'
    boot += '        var scenes = ' + json.dumps(chapters, separators=(',', ':')) + ';\n'
    boot += '        if (chapter >= 2 && chapter <= 5 && scenes[chapter]) window.SCENE_PATH = scenes[chapter];\n'
    boot += '    } catch (ignored) { /* The first chapter works without browser storage. */ }\n'
    boot += '}());\n'
    settings.write_text(boot)

    marker_path = root / 'release-ready.json'
    marker = json.loads(marker_path.read_text())
    marker['buildId'] = BUILD
    marker['chapters'] = [chapter_names[chapter] for chapter in range(1, 6)]
    marker['configSha256'] = hashlib.sha256(config_path.read_bytes()).hexdigest()
    marker['releaseControllerSha256'] = hashlib.sha256(content).hexdigest()
    marker_path.write_text(json.dumps(marker, indent=2) + '\n')
    return {'buildId': BUILD, 'root': str(root), 'bundleSha256': marker['releaseControllerSha256']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('game_root')
    args = parser.parse_args()
    print(json.dumps(patch(args.game_root), indent=2))
