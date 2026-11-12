// Send a same-origin API request and unwrap the response data.
export async function request(
  path,
  { method = "GET", body, signal, token } = {},
) {
  let response;
  try {
    response = await fetch("/api/" + path.replace(/^\//, ""), {
      method,
      signal,
      headers: {
        Accept: "application/json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: "Bearer " + token }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Cannot reach PawInn. Check that the service is running and try again.",
    );
  }
  if (response.status === 204) return null;
  const payload = await response
    .json()
    .catch(/* Handle responses whose body is empty or non-JSON. */ () => null);
  if (!response.ok || !payload || !Object.hasOwn(payload, "data")) {
    const error = new Error(
      payload?.message || "PawInn could not complete the request. Try again.",
    );
    error.status = response.status;
    throw error;
  }
  return payload.data;
}
