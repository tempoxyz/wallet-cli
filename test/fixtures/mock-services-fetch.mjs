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
    // Ids that name a `services` subcommand, or that incur would take for a typo of one.
    ...["list", "search", "show", "edgar-search"].map((id) => ({
      id,
      name: `Service ${id}`,
      serviceUrl: `https://${id}.example.com`,
      endpoints: [],
    })),
  ],
};

const realFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  // Wallet-app and chain RPC requests reach the test's local hosts.
  const url = String(input instanceof Request ? input.url : input);
  const hosts = [process.env.TEMPO_AUTH_URL, process.env.TEMPO_RPC_URL];
  if (hosts.some((host) => host && url.startsWith(host))) return await realFetch(input, init);
  return new Response(JSON.stringify(serviceDirectory), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
};
