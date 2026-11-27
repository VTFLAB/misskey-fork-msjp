import type { ChatCompletionMessageContent } from './types/oai-compat.js';
export interface SampleVideoOptions {
    /** Target sampling rate, in frames per second. With sampleVideo(), Qwen3-VL and LFM3 keep at most 2 frames per second. Default: 2 */
    fps?: number;
    /** Maximum number of frames. Each frame uses context tokens, so set this according to n_ctx. Default: 32 */
    maxFrames?: number;
    /** Maximum size of the longest edge, in pixels. Frames are never upscaled. Default: 512 */
    maxEdge?: number;
}
export interface SampledVideoFrame {
    /** Position of the frame in the video, in seconds */
    time: number;
    /** JPEG file content */
    data: ArrayBuffer;
}
/**
 * Get the evenly spaced positions to sample, in seconds. Position i is at i * duration / n, so the frame rate of the result is n / duration.
 */
export declare const getVideoSampleTimes: (duration: number, fps: number, maxFrames: number) => number[];
/**
 * Sample frames from a video with the video decoder of the browser. All formats that the browser can play are supported.
 *
 * This function needs the DOM, so it cannot run in a web worker. To read a URL from another origin, the server must allow CORS.
 *
 * @param source Video file, or URL of the video
 * @param options
 * @returns Frames in order of time
 */
export declare const sampleVideoFrames: (source: Blob | string, options?: SampleVideoOptions) => Promise<SampledVideoFrame[]>;
/**
 * Sample a video for native video input: `{ type: 'video', data: await sampleVideo(file) }`. The model gets the frames in its own video layout, for example Qwen3-VL merges each 2 frames.
 *
 * The model must support video input, see `supportInputModality('video')`. The result holds raw RGB frames, so its size is width * height * 3 bytes per frame.
 *
 * This function has the same limits as sampleVideoFrames().
 *
 * @param source Video file, or URL of the video
 * @param options
 * @returns Data for a content part of type "video"
 */
export declare const sampleVideo: (source: Blob | string, options?: SampleVideoOptions) => Promise<ArrayBuffer>;
/**
 * Sample a video into message content for createChatCompletion(). Each frame is an image part that follows its timestamp.
 *
 * The model must support image input. It reads the frames as separate images, so a model with its own video layout (for example Qwen3-VL) uses more tokens than with sampleVideo().
 *
 * @param source Video file, or URL of the video
 * @param options
 * @returns Content parts to add to the "content" of a message
 */
export declare const videoToMessageContent: (source: Blob | string, options?: SampleVideoOptions) => Promise<ChatCompletionMessageContent[]>;
