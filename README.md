# The Lost City: Port Harcourt

Static website and a self-hosted five-chapter PlayCanvas game. The website retains its original visual identity; release copy reflects the single-player campaign rather than the former ten-district/multiplayer concept.

## Current state

The five-scene PlayCanvas web export has been imported and its packaging checks pass. Play buttons are enabled locally. Level 1 is the entry scene. The release copy corrects the Level 3 scene name and Level 5 voice asset reference. It also saves the current chapter and returns there after a page refresh; refreshing restarts that chapter from its beginning. The Level 4 to Level 5 handoff saves the transit packet. The original Downloads folder is unchanged. Nothing has been deployed. A real browser gameplay smoke check remains outstanding.

## Import the game

1. Add `ReleaseLaunchController.js` FIRST on each gameplay scene's Systems entity, set the exact five scene names, and disable both developer-menu scripts in the Editor.
2. Download a PlayCanvas **web build ZIP**, including all five scenes and Level 1 as the entry scene.
3. Run `python3 tools/import_playcanvas.py /absolute/path/to/web-build.zip` from this repository.
4. Run `python3 tools/check_site.py --require-game`.

The importer checks scene scripts, startup scene and referenced assets before touching the existing build. It refuses unsafe ZIP entries and saves an existing game build outside the public directory. It does not change, upload or license your audio assets.

The currently selected Mac-generated voice files have not been cleared for public distribution; they remain at the owner's explicit request. See Apple's macOS licence section 2F. Hosting configuration does not establish asset rights.

## Preview

Run `python3 -m http.server 8000`, then visit `http://localhost:8000/`. Use HTTP rather than opening an HTML file from disk. The game remains unavailable until a real export passes import checks.

## Publish after review

1. Commit the reviewed website and checked `play/` build to GitHub.
2. In **Settings → Pages**, choose **GitHub Actions** as the publishing source.
3. In **Actions**, run **Publish the game website** manually.
4. Check the workflow's reported URL and run the hosted packaging smoke test.

The workflow requires a valid game export, stages only the public website files and `play/` directory, and uploads that folder to Pages. It does not auto-publish on every push. The intended GitHub project-site path is `/ph-horror/`; relative asset links work under that path.

## Scope

Desktop browser, keyboard and mouse, single player, five chapters. No working multiplayer, online leaderboard, email collection service or persistent campaign save is claimed. The original site profile and simulations are labelled as website-only previews. Browser storage is used for local website preferences.

## References

- [PlayCanvas self-hosting](https://developer.playcanvas.com/user-manual/editor/publishing/web/self-hosting/)
- [GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Apple macOS voice-use terms, section 2F](https://www.apple.com/legal/sla/docs/macOSTahoe.pdf)
