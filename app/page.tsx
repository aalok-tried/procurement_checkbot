export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Procurement CheckBot
        </h1>
        <p className="text-lg text-gray-700 mb-8">
          Find the best supplier for your materials
        </p>
        <div className="bg-white rounded-lg shadow-md p-8">
          <p className="text-gray-600">
            Welcome to the Procurement CheckBot application. This tool helps you identify the best suppliers for your materials.
          </p>
        </div>
      </div>
    </main>
  );
}
