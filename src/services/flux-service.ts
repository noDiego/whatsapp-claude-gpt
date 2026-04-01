import axios from 'axios';
import logger from '../logger';
import { AIConfig } from '../config';

export interface FluxGenerateParams {
    prompt: string;
    imageStreams?: Array<NodeJS.ReadableStream | null>;
    output_format?: 'jpeg' | 'png';
    size?: string; // e.g. "1024x1024"
    seed?: number;
}

export interface FluxImageResult {
    b64_json: string;
}

class FluxService {

    private readonly apiKey: string;
    private readonly model: string;
    private readonly baseURL = 'https://api.bfl.ai/v1';
    private readonly pollInterval = 2000; // ms
    private readonly maxPollAttempts = 60; // 96s max

    constructor() {
        this.apiKey = AIConfig.ImageConfig.apiKey;
        this.model = AIConfig.ImageConfig.model; // e.g. 'flux-2-pro-preview'
    }

    /**
     * Generates or edits an image using FLUX API.
     * - If no imageStreams provided → text-to-image (generation)
     * - If imageStreams provided → image editing (multi-reference)
     *
     * Returns array of { b64_json } to match OpenAI's interface in roboto.ts.
     */
    public async generateImage(params: FluxGenerateParams): Promise<FluxImageResult[]> {
        const isEdit = params.imageStreams && params.imageStreams.length > 0;

        logger.debug(
            `[FLUX->generateImage] Mode=${isEdit ? 'edit' : 'generate'}, ` +
            `refs=${params.imageStreams?.length ?? 0}, model=${this.model}`
        );

        // Build the request body
        const body: Record<string, any> = {
            prompt: params.prompt,
            output_format: params.output_format ?? 'jpeg',
        };

        // Optional size (width x height)
        if (params.size && params.size !== 'auto') {
            const [w, h] = params.size.split('x').map(Number);
            if (w && h) {
                body.width = w;
                body.height = h;
            }
        }

        if (params.seed != null) {
            body.seed = params.seed;
        }

        // Attach reference images as base64 if editing
        if (isEdit) {
            const imageKeys = ['input_image', 'input_image_2', 'input_image_3',
                'input_image_4', 'input_image_5', 'input_image_6',
                'input_image_7', 'input_image_8'];

            const base64Images = await Promise.all(
                params.imageStreams!.map(stream => this.streamToBase64(stream!))
            );

            for (let i = 0; i < base64Images.length && i < imageKeys.length; i++) {
                body[imageKeys[i]] = base64Images[i];
            }
        }

        // Submit request
        const submitResponse = await axios.post(
            `${this.baseURL}/${this.model}`,
            body,
            {
                headers: {
                    'accept': 'application/json',
                    'x-key': this.apiKey,
                    'Content-Type': 'application/json',
                }
            }
        );

        const { id: requestId, polling_url: pollingUrl } = submitResponse.data;

        if (!requestId) {
            logger.error(`[FLUX] Unexpected submit response: ${JSON.stringify(submitResponse.data)}`);
            throw new Error(`FLUX API did not return a request ID. Response: ${JSON.stringify(submitResponse.data)}`);
        }

        logger.debug(`[FLUX->generateImage] Request submitted. ID=${requestId}`);

        // Poll for result
        const resultUrl = await this.pollForResult(pollingUrl ?? `${this.baseURL}/get_result?id=${requestId}`);

        // Download the image and convert to base64
        const b64 = await this.urlToBase64(resultUrl);

        logger.debug(`[FLUX->generateImage] Image ready. b64 length=${b64.length}`);

        return [{ b64_json: b64 }];
    }

    // ── Private helpers ──────────────────────────────────────────────────────

    private async pollForResult(pollingUrl: string): Promise<string> {
        for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
            await this.sleep(this.pollInterval);

            const res = await axios.get(pollingUrl, {
                headers: {
                    'accept': 'application/json',
                    'x-key': this.apiKey,
                }
            });

            const { status, result } = res.data;
            logger.debug(`[FLUX->poll] attempt=${attempt + 1}, status=${status}`);

            if (status === 'Ready') {
                const imageUrl: string = result?.sample;
                if (!imageUrl) throw new Error('FLUX result is Ready but has no sample URL.');
                return imageUrl;
            }

            if (status === 'Error' || status === 'Failed') {
                throw new Error(`FLUX generation failed with status: ${status}. Detail: ${JSON.stringify(res.data)}`);
            }

            // Statuses: 'Pending', 'Processing' → keep polling
        }

        throw new Error(`FLUX polling timed out after ${(this.maxPollAttempts * this.pollInterval) / 1000}s`);
    }

    private async streamToBase64(stream: NodeJS.ReadableStream): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
            stream.on('error', reject);
        });
    }

    private async urlToBase64(url: string): Promise<string> {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data).toString('base64');
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

const FluxSvc = new FluxService();
export default FluxSvc;