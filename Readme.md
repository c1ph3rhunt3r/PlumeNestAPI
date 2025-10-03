

```markdown
# PlumeNest API

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Status](https://img.shields.io/badge/status-stable-green.svg)
![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)

## Overview

PlumeNest API is a private, high-performance web service designed to find and provide direct streamable and downloadable links for movies and TV shows. It is built with a robust, modular architecture in Node.js and Express, featuring a hybrid scraping engine, persistent caching with Redis, and a two-layer security model.

The primary purpose of this API is to serve as a backend for a desktop application, providing all the necessary data for a rich user experience, including metadata, subtitles, and direct M3U8 video source URLs.

## Core Features

-   **Comprehensive Search**: Scrapes fmovies.ro for content and enriches it with metadata from The Movie Database (TMDb) using a parallelized, high-performance matching system.
-   **Robust Stream Fetching**: Utilizes a lean, fast scraping method to extract direct stream URLs, bypassing complex anti-bot measures.
-   **Persistent Caching**: Integrates with Redis to cache all API responses (search, streams, seasons, episodes), dramatically reducing response times and protecting against rate-limiting.
-   **Professional Security**: Implements a two-layer authentication system:
    1.  **Global API Key (`X-API-KEY`)**: Protects the entire service from unauthorized client applications.
    2.  **User-Level JWTs (Auth0)**: Secures endpoints on a per-user basis, managed by Auth0 for industry-standard security.
-   **Modular & Maintainable**: The codebase is organized into logical services (scraping, database, caching) and uses external configuration for selectors, making it easy to update and maintain.
-   **Health & Monitoring**: Includes a public `/health` endpoint to monitor the API's status and its connection to critical dependencies like Redis.
-   **API Versioning**: All protected routes are versioned under `/api/v1` to ensure long-term compatibility with client applications.

---

## Project Structure

The project is organized into a modular structure for clarity and separation of concerns.

```/PlumeNestAPI
|-- /config/             # All configuration files
|   |-- index.js         # Loads and exports all config variables
|   |-- logger.js        # Winston logger configuration
|   |-- selectors.json   # CSS selectors for scraping
|
|-- /services/           # Core business logic
|   |-- cache.js         # Redis client initialization
|   |-- fmovies.js       # Logic for scraping fmovies.ro
|   |-- stream.js        # Core logic for fetching stream/subtitle URLs
|   |-- tmdb.js          # Logic for fetching data from TMDb
|
|-- /utils/              # Small, reusable helper functions
|   |-- playlistParser.js# M3U8 playlist parsing utility
|
|-- .env                 # Environment variables (secrets)
|-- server.js            # Express server and API route definitions
|-- package.json         # Project dependencies and scripts
|-- README.md            # This file
```

---

## Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (v18.x or higher recommended)
-   An active [Redis](https://redis.io/) instance (e.g., from [Render](https://render.com))
-   An [Auth0](https://auth0.com/) account
-   A [TMDb](https://www.themoviedb.org/signup) API Key

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone <your-repo-url>
    cd PlumeNestAPI
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create the `.env` file:**
    Create a `.env` file in the root of the project. This file stores your secret keys and environment-specific configuration. Copy the contents of `.env.example` (if you have one) or use the template below.

    ```env
    # Server Configuration
    PORT=3001

    # External Services
    TMDB_API_KEY=your_tmdb_api_key_here
    REDIS_URL=your_redis_connection_string_here

    # Security
    API_SECRET_KEY=generate_a_long_random_string_for_your_api_key
    AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com/
    AUTH0_AUDIENCE=https://your-api-identifier.com
    ```

4.  **Run the server:**
    ```bash
    npm start
    ```
    The API will be available at `http://localhost:3001`.

---

## API Endpoints

All protected endpoints are versioned under `/api/v1` and require two authentication headers: `X-API-KEY` and `Authorization: Bearer <JWT>`.

### Public Endpoints

#### `GET /health`
Checks the health of the API and its dependencies.
-   **Success Response (`200 OK`):**
    ```json
    { "status": "ok", "dependencies": { "redis": "connected" } }
    ```
-   **Error Response (`503 Service Unavailable`):**
    ```json
    { "status": "error", "dependencies": { "redis": "disconnected" } }
    ```

### Protected Endpoints (v1)

#### `GET /api/v1/search`
Searches for a movie or TV show.
-   **Query Parameters:**
    -   `title` (string, required): The title to search for.
    -   `type` (string, optional): The type of content ('movie' or 'tv').
-   **Success Response (`200 OK`):**
    ```json
    {
      "id": "19788",
      "type": "movie",
      "title": "Interstellar",
      "year": "2014",
      "overview": "The adventures of a group of explorers...",
      "posterUrl": "https://image.tmdb.org/t/p/w500/...",
      "tmdbId": 157336
    }
    ```

#### `GET /api/v1/stream`
Retrieves the stream sources and subtitles for a specific movie ID or TV show episode ID.
-   **Query Parameters:**
    -   `id` (string, required): The ID from the `/search` endpoint (for movies) or `/episodes` endpoint (for TV).
    -   `type` (string, required): The type of content ('movie' or 'tv').
-   **Success Response (`200 OK`):**
    ```json
    {
      "sources": [
        { "quality": "1080p", "url": "https://.../1080p.m3u8" },
        { "quality": "720p", "url": "https://.../720p.m3u8" }
      ],
      "subtitles": [
        { "file": "https://.../eng.vtt", "label": "English", "kind": "captions" }
      ],
      "decryptionKey": null,
      "sourceServer": "MegaCloud",
      "refererUrl": "https://videostr.net/..."
    }
    ```

#### `GET /api/v1/seasons`
Gets a list of seasons for a TV show.
-   **Query Parameters:**
    -   `showId` (string, required): The `id` of a TV show from the `/search` endpoint.

#### `GET /api/v1/episodes`
Gets a list of episodes for a specific season.
-   **Query Parameters:**
    -   `seasonId` (string, required): The `seasonId` from the `/seasons` endpoint.

---

## Future Development

The API is stable and client-ready. The next major phase of development will focus on integrating a database (e.g., Supabase) to enable user-specific features.

-   **User Syncing:** Automatically create a user profile in the database upon their first authenticated request.
-   **Watch History:** Implement endpoints to log and retrieve a user's viewing history.
-   **Favorites / Watchlist:** Add functionality for users to save content to a personal list.
