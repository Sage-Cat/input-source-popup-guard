UUID := input-source-popup-guard-v2@sagecat.local
DESTDIR ?= $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: test check install
test:
	node --test tests/*.test.js
check:
	node --check extension.js
	node --check guard.js
install: check test
	install -d "$(DESTDIR)"
	install -m 0644 metadata.json extension.js guard.js buildInfo.js "$(DESTDIR)/"
