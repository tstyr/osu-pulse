export class RequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "RequestError";
  }
}

/** Read-only requests can be cancelled on navigation and never wait indefinitely. */
export async function requestJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  try {
    const timeout = AbortSignal.timeout(30_000);
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) {
      const message = response.status === 401
        ? "ログインの有効期限が切れました。再ログインしてください。"
        : response.status === 429
          ? "アクセスが集中しています。少し待ってから再試行してください。"
          : `データを取得できませんでした（${response.status}）。再試行してください。`;
      throw new RequestError(message, response.status);
    }
    return await response.json() as T;
  } catch (error) {
    if (signal?.aborted || error instanceof RequestError) throw error;
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new RequestError("応答に時間がかかっています。接続を確認して再試行してください。", 408);
    }
    throw new RequestError("通信できませんでした。接続を確認して再試行してください。", 0);
  }
}

export const liveRequestOptions = {
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  keepPreviousData: true,
  errorRetryCount: 3,
  errorRetryInterval: 5_000,
  shouldRetryOnError: (error: Error) => !(error instanceof RequestError && [401, 403].includes(error.status)),
};
