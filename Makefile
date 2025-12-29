.PHONY: run
run:
	python -m http.server 8888 &> http.log &
