const serviceDirectory = {
  services: [
    {
      id: "weather",
      name: "Weather API",
      url: "https://weather.example.com",
      serviceUrl: "https://weather.mpp.tempo.xyz",
      description: "Forecasts and current conditions",
      categories: ["data", "climate"],
      tags: ["forecast", "meteorology"],
      endpoints: [
        {
          method: "GET",
          path: "/now",
          description: "Current weather",
          payment: { intent: "pay", amount: "100", decimals: 6, unitType: "usdc" },
          docs: "https://weather.example.com/docs",
        },
      ],
      docs: {
        homepage: "https://weather.example.com",
        llmsTxt: "https://weather.example.com/llms.txt",
      },
    },
  ],
};

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  // Device-code login requests reach the test's wallet host.
  const authUrl = process.env.TEMPO_AUTH_URL;
  if (authUrl && String(input instanceof Request ? input.url : input).startsWith(authUrl))
    return await realFetch(input, init);
  return new Response(JSON.stringify(serviceDirectory), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
};
