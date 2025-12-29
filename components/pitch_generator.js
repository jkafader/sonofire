import 'https://unpkg.com/d3@7.9.0';
import { MIDI_NOTES_FLAT, MIDI_NOTES_SHARP, SCALES, MIDI_CHANNELS, SCALE_TONES } from "../lib/midi_data.js";

export class SonofirePitchGenerator extends HTMLElement {

    constructor(){
        super(); // have to call the superclass constructor first...

        this.midi = null;
        this.noteBoundaries = [];

        // these should be attributes...
        this.margin = {top: 10, right: 30, bottom: 30, left: 60};
        this.width = 720 - this.margin.left - this.margin.right;
        this.height = 300 - this.margin.top - this.margin.bottom;
        this.playingNotes = new Set();
        this.playIntervalHandle = null;

        this.frameDelay = 400; // 400ms
        this.noteDuration = 300; // 300ms

        this.selectedScale = "0";
        this.selectedChannel = "0"; // channel 1
        this.selectedClock = "25";
        this.selectedDuration = "10";
    }

    connectedCallback(){
        navigator.requestMIDIAccess().then((midiAccess)=>{ this.onMIDISuccess(midiAccess) }, ()=>{ this.onMIDIFailure() });
        this.render();
    }

    onMIDISuccess(midiAccess) {
        console.log("MIDI ready!");
        this.midi = midiAccess;
        this.listInputsAndOutputs();
    }

    onMIDIFailure(msg) {
        window.alert(`Failed to get MIDI access - ${msg}`);
    }

    listInputsAndOutputs() {
        for (const entry of this.midi.inputs) {
	    const input = entry[1];
	    console.log(
                `Input port [type:'${input.type}']` +
		    ` id:'${input.id}'` +
		    ` manufacturer:'${input.manufacturer}'` +
		    ` name:'${input.name}'` +
		    ` version:'${input.version}'`,
	    );
        }
        for (const entry of this.midi.outputs) {
	    const output = entry[1];
	    console.log(
                `Output port [type:'${output.type}'] id:'${output.id}' manufacturer:'${output.manufacturer}' name:'${output.name}' version:'${output.version}'`,
	    );
        }
    }

    calculateScalePartitions(scaleName, scaleTones, root, octaves){
        let partitions = [];
        let scale = SCALES[""+scaleName];
        root = scale.indexOf(parseInt(root));
        let i = 0;
        for(let t=root; t < (root + (parseInt(octaves) * 7)) && t < scale.length; t++){
	    let note = scale[t];
	    let to_push = SCALE_TONES[scaleTones](i, note);
	    partitions.push(to_push);
	    i++;
	    i = i % 7;
        }
        partitions = partitions.filter((i)=>{ return i !== null });
        partitions.reverse();
        return partitions;
    }

    async renderGraph(){
        // set the dimensions and margins of the graph
        let scale = document.querySelector("#scale")?.value;
        let scaleTones = document.querySelector("#scale_tones")?.value;
        let root = document.querySelector("#scale_root")?.value;
        let octaves = document.querySelector("#octaves")?.value;
        this.noteBoundaries = [];

        console.log('scale', scale, 'scaleTones', scaleTones, 'root', root, 'octaves', octaves);

        let partitions = this.calculateScalePartitions(scale, scaleTones, root, octaves);
        console.log("partitions", partitions);

        let node = document.querySelector("#my_dataviz svg");
        node?.remove();

        // append the svg object to the body of the page
        var svg = d3.select("#my_dataviz")
	    .append("svg")
            .attr("width", this.width + this.margin.left + this.margin.right)
            .attr("height", this.height + this.margin.top + this.margin.bottom)
	    .append("g")
            .attr("transform",
                  "translate(" + this.margin.left + "," + this.margin.top + ")");

        // Add X axis
        var x = d3.scaleTime()
            .domain([
                new Date("1956-01-01T00:00:00Z"),
                new Date("1995-09-01T00:00:00Z")
            ])
            .range([ 0, this.width ]);
        svg.append("g")
            .attr("transform", "translate(0," + this.height + ")")
            .call(d3.axisBottom(x));

        // Add Y axis
        var y = d3.scaleLinear()
            .domain([50, 250])
            .range([ this.height, 0]);
        svg.append("g")
            .call(d3.axisLeft(y));

        for(let i=0; i<partitions.length; i++){
            let opacity = i % 2 == 0 ? "0.1" : "0.00"

            let upperBoundary = (i + 1) * (this.height / partitions.length);
            let lowerBoundary = i * (this.height / partitions.length);

            this.noteBoundaries.push({
                lowerBoundary: lowerBoundary,
                upperBoundary: upperBoundary,
                note: partitions[i]
            })

            console.log("boundaries", this.noteBoundaries);

            svg.append("rect")
                .attr("fill", `rgba(0, 0, 0, ${opacity})`)
                .attr("x", 0)
                .attr("width", this.width)
                .attr("y", lowerBoundary)
                .attr("height", upperBoundary - lowerBoundary)
            console.log(i * (this.height / partitions.length), (this.height / partitions.length))
        }


        // Read the data
        const data = await d3.csv("./beer_production.csv");

        // these 4 lines vary with the dataset
        const x_column = 'date';
        const y_column = 'production';
        const get_x = (d)=>{ return new Date(d[x_column]) };
        const get_y = (d)=>{ return d[y_column]; };

        const plotData = (data)=>{
	    // Add dots
	    svg.append('g')
                .selectAll("dot")
                .data(data)
                .enter()
                .append("circle")
                .attr("cx", function (d) { return x(get_x(d)) } )
                .attr("cy", function (d) { return y(get_y(d)); } )
                .attr("class", (d)=>{
		    let noteBoundary = "";
		    for(let i=0; i<this.noteBoundaries.length; i++){
			if(y(get_y(d)) >= this.noteBoundaries[i]["lowerBoundary"] &&
                           y(get_y(d)) < this.noteBoundaries[i]["upperBoundary"]){
			    noteBoundary = `note-${this.noteBoundaries[i]["note"]}`
			    break;
			}
		    }
		    return `x-${parseInt(x(get_x(d)))} ${noteBoundary}`;
                })
                .attr("r", 1.5)
                .style("fill", "#69b3a2")

        }
        plotData(data);
    }

    fireNotes(notes, duration){
        notes.forEach((note)=>{
	    if(!note) return // bad data
	    if(this.playingNotes.has(note)) return // note is already fired but not cleared
	    let noteName = MIDI_NOTES_FLAT[note];
	    if(this.selectedScale.indexOf("♯") >= 0){
                noteName = MIDI_NOTES_SHARP[note]
	    }
	    for (const entry of this.midi.outputs) {
                const output = entry[1];
                let header = 0x90 // "most significant byte" nibble -- note on
                let channel = parseInt(this.selectedChannel)
                let velocity = 0x4F // full velocity
                console.log("sending note on", `ch: ${channel+1} note: ${noteName}, velo: ${velocity}`)
                this.playingNotes.add(note);
                output.send([header + channel, note, velocity]);
                let off = (output, note)=>{ // close around 'output'
		    return ()=>{
			let header = 0x80 // "most significant byte" nibble -- note off
			let channel = parseInt(this.selectedChannel)
			let velocity = 0x00 // note off
			console.log("sending note off", `ch: ${channel+1} note: ${noteName}, velo: ${velocity}`);
			this.playingNotes.delete(note)
			output.send([header + channel, note, velocity]);
		    }
                }
                window.setTimeout(off(output, note), duration);
	    }
        });
    }

    tickFrame(){
        let svg = d3.select("#my_dataviz svg");
        let parent = svg.select("g");

        const playhead = parent.select('.playhead').node()
	      ? parent.select('.playhead')
	      : parent.append('line')
              .attr("class", "playhead")

        let curr_x = playhead.attr('data-x') || 0;
        if(parseInt(curr_x) > parseInt(this.width)){
	    curr_x = 0;
        }

        playhead
	    .style('stroke', 'black')
	    .attr('x1', 1)
	    .attr('y1', 0)
	    .attr('x2', 1)
	    .attr('y2', 300)
	    .attr('data-x', parseInt(curr_x) + 1)
	    .attr('transform', `translate(${curr_x} 0)`)

        let self = this;
        parent.selectAll(`.x-${curr_x}`)
	    .attr("r", 5)
	    .each((d, i, e)=>{
                let notes = [];
                e.forEach((elem)=>{
		    elem.classList.forEach((c)=>{
			if(c.startsWith("note-")){
			    notes.push(c.replace("note-", ""))
			}
		    });
		    setTimeout(()=>{ elem.setAttribute("r", 1.5); }, parseInt(this.selectedDuration))
                });
                self.fireNotes([...new Set(notes)], parseInt(this.selectedDuration))
	    })

    }

    play(){
        if(this.playIntervalHandle === null){
	    let clockDelay = parseInt(this.selectedClock);
	    console.log('clock', clockDelay);
	    this.playIntervalHandle = window.setInterval(
                ()=>{ this.tickFrame() },
                clockDelay
	    );
        }
    }
    stop(){
        clearInterval(this.playIntervalHandle);
        this.playIntervalHandle = null;
    }
    rewind(){
        let svg = d3.select("#my_dataviz svg");
        let parent = svg.select("g");

        const playhead = parent.select('.playhead')

        playhead.attr("data-x", 0);
    }


    renderScaleRootOptions(){
        let options = [];
        let MIDI_NOTES = MIDI_NOTES_FLAT;
        if(this.selectedScale.indexOf("♯") >= 0){
	    MIDI_NOTES = MIDI_NOTES_SHARP;
        }
        if(this.selectedScale.indexOf("♭") >= 0){
	    MIDI_NOTES = MIDI_NOTES_FLAT;
        }
        SCALES[this.selectedScale].forEach((note)=>{
	    options.push(`<option value='${note}' ${note == this.selectedScaleRoot ? "selected" : ""}>${MIDI_NOTES[note]}</option>`);
        });
        return `<select id='scale_root'>
              ${options.join("\n")}
            </select>`
    }

    renderScaleTonesOptions(){
        let options = [];
        let scaleTones = [
	    ["1", "1 - root only"],
	    ["3", "3 - root, 3rd, 5th"],
	    ["4", "5 - root, 3rd, 4th, 5th"],
	    ["5", "5 - root, 3rd, 4th, 5th, 7th"],
	    ["7", "7 - root, 2nd, 3rd, 4th, 5th, 6th, 7th"],
	    ["12", "not implemented yet..."],
        ]
        scaleTones.forEach((tone)=>{
	    options.push(`<option value='${tone[0]}' ${tone[0] == this.selectedScaleTones ? "selected" : ""}>${tone[1]}</option>`)
        })
        return `<select id='scale_tones'>
              ${options.join("\n")}
            </select>`
    }

    renderScaleOptions(){
        let options = [];
        let scales = ["6♯", "5♯", "4♯", "3♯", "2♯", "1♯", "0", "1♭", "2♭", "3♭", "4♭", "5♭"];
        scales.forEach((scale)=>{
	    options.push(`<option value="${scale}" ${scale == this.selectedScale ? "selected" : ""}>${scale}</option>`)
        })
        return `<select id='scale'>
                ${options.join("\n")}
              </select>`
    }

    renderOctaveOptions(){
        let options = [];
        let octaves = ["1", "2", "3", "4", "5"];
        octaves.forEach((octave)=>{
	    options.push(`<option value='${octave}' ${octave == this.selectedOctaves ? "selected" : ""}>
                ${octave} octave${ octave == 1 ? "" : "s" }
              </option>`);
        })
        return `<select id='octaves'>
              ${options.join("\n")}
            </select>`
    }

    renderMIDIChannelOptions(){
        let options = [];
        let channels = MIDI_CHANNELS;
        channels.forEach((channel)=>{
	    options.push(`<option value='${channel}' ${this.selectedChannel == channel ? "selected" : ""}>${channel+1}</option>`)
        });
        return `<select id='channel'>${options.join("\n")}</select>`
    }

    renderClockOptions(){
        let options = [];
        let clockOptions = [
	    [25, "25ms"],
	    [50, "50ms"],
	    [100, "100ms"],
	    [200, "200ms"],
	    [300, "300ms"],
	    [400, "400ms"],
	    [500, "500ms"],
	    [0, "MIDI Slave"]
        ];
        clockOptions.forEach((clock)=>{
	    options.push(`<option value='${clock[0]}' ${parseInt(this.selectedClock) == clock[0] ? "selected" : ""}>
                ${clock[1]}
              </option>`);
        })
        return `<select id='clock'>${options.join("\n")}</select>`;
    }

    renderDurationOptions(){
        let options = [];
        let noteDurations = [
	    [10, "10ms"],
	    [15, "15ms"],
	    [25, "25ms"],
	    [50, "50ms"],
	    [100, "100ms"],
	    [150, "150ms"],
	    [200, "200ms"],
	    [250, "250ms"],
	    [300, "300ms"],
	    [500, "500ms"],
	    [750, "750ms"],
	    [1000, "1s"],
        ];
        noteDurations.forEach((duration)=>{
	    options.push(`<option value='${duration[0]}' ${parseInt(this.selectedDuration == duration[0])}>${duration[1]}</option>`)
        })
        return `<select id='duration'>${options.join("\n")}</select>`
    }

    render(){
        if(!this.root){
	    this.root = document.createElement("div");
	    this.appendChild(this.root);
        }
        this.root.innerHTML = `
              <style>
              body { font-family: Arial, Helvetica, sans-serif; }
              </style>
              <div id='my_dataviz'></div>
              <table>
                <tr>
                  <td>Tones per Octave</td>
                  <td>Scale</td>
                  <td>Root</td>
                  <td>Octaves</td>
                  <td>Channel</td>
                  <td>Clock</td>
                  <td>Note Length</td>
                </tr>
                <tr>
                  <td>
                    ${this.renderScaleTonesOptions()}
                  </td>
                  <td>
                    ${this.renderScaleOptions()}
                  </td>
                  <td>
                    ${this.renderScaleRootOptions()}
                  </td>
                  <td>
                    ${this.renderOctaveOptions()}
                  </td>
                  <td>
                    ${this.renderMIDIChannelOptions()}
                  </td>
                  <td>
                    ${this.renderClockOptions()}
                  </td>
                  <td>
                    ${this.renderDurationOptions()}
                  </td>
                  <td>
                    <table><tr>
                      <td><button id='play'>▶</button></td>
                      <td><button id='stop'>⏹</button></td>
                      <td><button id='rewind'>⏮</button></td>
                    </tr></table>
                  </td>
                </tr>
              </table>`;

        this.root.querySelector("#scale").onchange = ()=>{ 
            this.selectedScale = this.root.querySelector("#scale").value;
            this.render()
        };
        this.root.querySelector("#scale_tones").onchange = ()=>{
            this.selectedScaleTones = this.root.querySelector("#scale_tones").value;
            this.render()
        };
        this.root.querySelector("#scale_root").onchange = ()=>{
            this.selectedScaleRoot = this.root.querySelector("#scale_root").value;
            this.render()
        };
        this.root.querySelector("#octaves").onchange = ()=>{
            this.selectedOctaves = this.root.querySelector("#octaves").value;
            this.render()
        };
        this.root.querySelector("#channel").onchange = ()=>{
            this.selectedChannel = this.root.querySelector("#channel").value;
            this.render();
        }
        this.root.querySelector("#clock").onchange = ()=>{
            this.selectedClock = this.root.querySelector("#clock").value;
            this.stop();
            this.play();
            this.render();
        }
        this.root.querySelector("#duration").onchange = ()=>{
            this.selectedDuration = this.root.querySelector("#duration").value;
            this.render();
        }

        this.root.querySelector("#play").onclick = ()=>{ this.play() };
        this.root.querySelector("#stop").onclick = ()=>{ this.stop() };
        this.root.querySelector("#rewind").onclick = ()=>{ this.rewind() };

        this.renderGraph();
    }
}


customElements.define("sonofire-pitch-generator", SonofirePitchGenerator);
