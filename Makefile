.PHONY: run test test-browser test-ui

run:
	python -m http.server 8888 &> http.log &

test:
	npm test

test-browser:
	npm run test:browser

test-ui:
	npm run test:ui
