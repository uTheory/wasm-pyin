import { default as PYINInit, wasmPYin } from './pkg/pyin.js';

/**
 * Configuration settings for user media.
 */
export interface WasmPitchMediaTrackConstraints {
  autoGainControl?: boolean;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  /**
   * When present, applies a low cut filter to everything below
   * the specified frequency.
   */
  lowCutFrequencyHz?: number;
  /**
   * When present, applies a high cut filter to everything above
   * the specified frequency.
   */
  highCutFrequencyHz?: number;
  /**
   * 0-1, default 1. How steep the cutoff is at the band pass/cut frequencies.
   * Only has an effect if lowCutFrequencyHz or highCutFrequencyHz are present.
   */
  filterQualityFactor?: number;
}

type PYINCallback = (freq: number, voicedConfidence: number) => void;

export class PYINPitch {
  private callbacks: PYINCallback[] = [];

  private mediaStream: MediaStream | undefined;

  /** This instance's AudioContext */
  private audioContext: AudioContext | BaseAudioContext | undefined;

  /**
   * Although this approach is deprecated in favor of audio worklets, we cannot move
   * on until Safari decides to support worklets.
   */
  private processorNode: ScriptProcessorNode | undefined;

  /**
   * Used if lowCutFrequencyHz or highCutFrequencyHz present in options.
   */
  private filterNodes: BiquadFilterNode[] = [];

  public get filteredNode() {
    return this.filterNodes.length
      ? this.filterNodes[this.filterNodes.length - 1]
      : this.sourceNode;
  }

  /**
   * Has the wasm pitch instance been started?
   */
  public isRunning = false;

  /** Internal wasm load state */
  private isLoaded = false;

  /** Is the audio initialized? */
  public isAudioInitialized = false;

  public sourceNode: MediaStreamAudioSourceNode | undefined;

  private loadingPromise: Promise<void> | undefined;

  constructor(
    pathToWasm: string = '',
    private mediaTrackOptions: WasmPitchMediaTrackConstraints = {}
  ) {
    this.initWasm(pathToWasm);
  }

  private async initWasm(pathToWasm: string) {
    this.loadingPromise = new Promise(async (resolve, reject) => {
      // Load the wasm.
      try {
        await PYINInit(pathToWasm);
        resolve();
      } catch (err) {
        console.error('Error loading wasm for pyin-pitch.');
        console.error(err);
        reject(err);
        throw err;
      }
      this.isLoaded = true;
    });
  }

  /**
   * Initialize audio from a source or, if none is provided, by requesting
   * access to the user's microphone.
   *
   * Must be called before calling WasmPitch.start()
   * @param sourceNode
   */
  async init(sourceNode?: MediaStreamAudioSourceNode) {
    if (sourceNode) {
      this.audioContext = sourceNode.context;
      this.sourceNode = sourceNode;
    } else {
      const audioContext = new AudioContext();
      // Get the media stream from client's microphone using the WebRTC API
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: this.mediaTrackOptions,
      });

      this.sourceNode = audioContext.createMediaStreamSource(this.mediaStream);
      this.audioContext = audioContext;
      this.createFilterNodes();
    }

    // Set up the audio processing using AudioProcessorNode API
    const bufferLength = 1024;
    this.processorNode = this.audioContext.createScriptProcessor(bufferLength, 1, 1);
    this.processorNode.onaudioprocess = (evt) => {
      if (!this.audioContext) throw Error('Audio context required to process audio.');
      const pcmArray = evt.inputBuffer.getChannelData(0);

      try {
        const result = wasmPYin(pcmArray, this.audioContext.sampleRate, bufferLength, 22, 1200);
        this.callbacks.forEach((callback) => callback(result[0] || -1, result[1] || 0));
      } catch (e) {
        throw e;
      }
    };

    try {
      await this.loadingPromise;
      this.isAudioInitialized = true;
      return this;
    } catch (e) {
      throw e;
    }
  }

  private createFilterNodes() {
    if (!this.audioContext) {
      throw Error('AudioContext required to create filter nodes.');
    }
    if (!this.mediaTrackOptions.lowCutFrequencyHz && !this.mediaTrackOptions.highCutFrequencyHz)
      return;

    if (this.mediaTrackOptions.lowCutFrequencyHz) {
      const filterNode = this.audioContext.createBiquadFilter();
      filterNode.type = 'highpass';
      filterNode.frequency.value = this.mediaTrackOptions.lowCutFrequencyHz;
      filterNode.Q.value = this.mediaTrackOptions.filterQualityFactor || 1;
      this.filterNodes.push(filterNode);
    }

    if (this.mediaTrackOptions.highCutFrequencyHz) {
      const filterNode = this.audioContext.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.value = this.mediaTrackOptions.highCutFrequencyHz;
      filterNode.Q.value = this.mediaTrackOptions.filterQualityFactor || 1;
      this.filterNodes.push(filterNode);
    }
  }

  /**
   * Gets the AudioContext being used
   */
  getAudioContext() {
    return this.audioContext;
  }

  /**
   * Starts the pitch dictation machinery
   */
  start() {
    if (!this.isLoaded || !this.isAudioInitialized) {
      throw Error('Must await WasmPitch.init() before calling start.');
    }
    if (!this.audioContext) {
      throw Error('AudioContext required to start pitch detection.');
    }

    const signalChain = [
      this.sourceNode,
      ...this.filterNodes,
      this.processorNode,
      this.audioContext.destination,
    ];
    console.log('signal chain', signalChain);
    signalChain.reduce((a, b) => {
      if (a && b) {
        a.connect(b);
        return b;
      }
      return a;
    });
    this.isRunning = true;
  }

  /**
   * Stops the pitch detection machinery
   */
  stop() {
    this.isRunning = false;
    if (!this.isLoaded || !this.isAudioInitialized)
      throw Error('Must await WasmPitch.init() before calling stop.');
    if (!this.processorNode) throw Error('start() has not been called');

    if (this.mediaStream) this.mediaStream.getTracks()[0]?.stop();
    const signalChain = [
      this.sourceNode,
      ...this.filterNodes,
      this.processorNode,
      this.audioContext?.destination,
    ];
    signalChain.forEach((node) => node?.disconnect());
  }

  /**
   * Add callbacks that are called whenever a frequency is dictated
   * @param {(freq: number) => any} callback argument freq is -1 when input is so soft that
   * a pitch cannot be detected
   */
  addListener(callback: PYINCallback) {
    this.callbacks.push(callback);
  }

  removeListener(callback: PYINCallback) {
    const index = this.callbacks.indexOf(callback);
    if (index === -1) return false;
    this.callbacks.splice(index, 1);
    return true;
  }
}
