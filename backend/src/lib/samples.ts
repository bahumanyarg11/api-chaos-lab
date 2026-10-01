export const SAMPLES: { id: string; name: string; description: string; spec: string }[] = [
  {
    id: "acme-store",
    name: "Acme Store & Payments",
    description: "E-commerce API with products, cart, checkout, payments and auth — the playground demo uses this one.",
    spec: `openapi: 3.0.3
info:
  title: Acme Store & Payments API
  version: 2.4.0
  description: Storefront API for Acme — catalog, cart, checkout and card payments.
servers:
  - url: https://api.acme-store.example.com/v2
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
  schemas:
    Product:
      type: object
      required: [id, name, price, currency, inStock]
      properties:
        id: { type: string, example: prod_9f2k1 }
        name: { type: string }
        price: { type: number }
        currency: { type: string, enum: [USD, EUR, INR] }
        inStock: { type: boolean }
        rating: { type: number }
        imageUrl: { type: string, format: uri }
    User:
      type: object
      required: [id, email, name, plan]
      properties:
        id: { type: string }
        email: { type: string, format: email }
        name: { type: string }
        plan: { type: string, enum: [free, pro, enterprise] }
        createdAt: { type: string, format: date-time }
    Payment:
      type: object
      required: [id, status, amount, currency]
      properties:
        id: { type: string }
        status: { type: string, enum: [succeeded, pending, failed] }
        amount: { type: number }
        currency: { type: string }
        orderId: { type: string }
        createdAt: { type: string, format: date-time }
    Order:
      type: object
      required: [id, status, total, items]
      properties:
        id: { type: string }
        status: { type: string, enum: [placed, paid, shipped, delivered] }
        total: { type: number }
        items:
          type: array
          items:
            type: object
            properties:
              productId: { type: string }
              quantity: { type: integer }
security:
  - bearerAuth: []
paths:
  /health:
    get:
      summary: Health check
      security: []
      responses:
        "200": { description: ok, content: { application/json: { schema: { type: object, properties: { status: { type: string } } } } } }
  /auth/login:
    post:
      summary: Log in with email and password
      security: []
      requestBody:
        content:
          application/json:
            schema: { type: object, required: [email, password], properties: { email: { type: string }, password: { type: string } } }
      responses:
        "200":
          description: Session tokens
          content:
            application/json:
              schema: { type: object, required: [accessToken, refreshToken, expiresIn], properties: { accessToken: { type: string }, refreshToken: { type: string }, expiresIn: { type: integer } } }
        "401": { description: Invalid credentials }
  /users/me:
    get:
      summary: Get the signed-in user's profile
      responses:
        "200": { description: Current user, content: { application/json: { schema: { $ref: "#/components/schemas/User" } } } }
        "401": { description: Unauthorized }
  /products:
    get:
      summary: List products in the catalog
      parameters:
        - { name: q, in: query, schema: { type: string } }
        - { name: limit, in: query, schema: { type: integer } }
      responses:
        "200":
          description: Product page
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/Product" }
  /products/{productId}:
    get:
      summary: Get product details
      parameters:
        - { name: productId, in: path, required: true, schema: { type: string } }
      responses:
        "200": { description: Product, content: { application/json: { schema: { $ref: "#/components/schemas/Product" } } } }
        "404": { description: Not found }
  /cart/items:
    post:
      summary: Add an item to the cart
      requestBody:
        content:
          application/json:
            schema: { type: object, required: [productId, quantity], properties: { productId: { type: string }, quantity: { type: integer } } }
      responses:
        "201": { description: Updated cart, content: { application/json: { schema: { type: object, properties: { cartId: { type: string }, itemCount: { type: integer }, subtotal: { type: number } } } } } }
  /checkout:
    post:
      summary: Convert the cart into an order
      responses:
        "201": { description: Order placed, content: { application/json: { schema: { $ref: "#/components/schemas/Order" } } } }
        "409": { description: Cart changed }
  /payments:
    post:
      summary: Charge a card for an order
      description: Charges the customer's card. Supports the Idempotency-Key header.
      parameters:
        - { name: Idempotency-Key, in: header, schema: { type: string } }
      requestBody:
        content:
          application/json:
            schema: { type: object, required: [orderId, amount, currency, cardToken], properties: { orderId: { type: string }, amount: { type: number }, currency: { type: string }, cardToken: { type: string } } }
      responses:
        "201": { description: Payment, content: { application/json: { schema: { $ref: "#/components/schemas/Payment" } } } }
        "402": { description: Card declined }
        "429": { description: Too many requests }
  /orders/{orderId}:
    get:
      summary: Get an order
      parameters:
        - { name: orderId, in: path, required: true, schema: { type: string } }
      responses:
        "200": { description: Order, content: { application/json: { schema: { $ref: "#/components/schemas/Order" } } } }
`,
  },
  {
    id: "petstore",
    name: "Swagger Petstore (OpenAPI 3)",
    description: "The classic Petstore — pets, store orders and users.",
    spec: JSON.stringify({
      openapi: "3.0.2",
      info: { title: "Swagger Petstore", version: "1.0.17", description: "Sample Pet Store Server based on the OpenAPI 3.0 specification." },
      servers: [{ url: "https://petstore3.swagger.io/api/v3" }],
      components: {
        schemas: {
          Pet: { type: "object", required: ["name", "photoUrls"], properties: { id: { type: "integer" }, name: { type: "string", example: "doggie" }, category: { type: "object", properties: { id: { type: "integer" }, name: { type: "string" } } }, photoUrls: { type: "array", items: { type: "string" } }, status: { type: "string", enum: ["available", "pending", "sold"] } } },
          Order: { type: "object", properties: { id: { type: "integer" }, petId: { type: "integer" }, quantity: { type: "integer" }, shipDate: { type: "string", format: "date-time" }, status: { type: "string", enum: ["placed", "approved", "delivered"] }, complete: { type: "boolean" } } },
        },
        securitySchemes: { api_key: { type: "apiKey", name: "api_key", in: "header" } },
      },
      paths: {
        "/pet": { post: { summary: "Add a new pet to the store", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } }, responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } } }, put: { summary: "Update an existing pet", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } }, responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } } } },
        "/pet/findByStatus": { get: { summary: "Finds Pets by status", parameters: [{ name: "status", in: "query", schema: { type: "string" } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Pet" } } } } } } } },
        "/pet/{petId}": { get: { summary: "Find pet by ID", parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } }, "404": { description: "Pet not found" } } }, delete: { summary: "Deletes a pet", parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }], responses: { "400": { description: "Invalid pet value" } } } },
        "/store/order": { post: { summary: "Place an order for a pet", requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } }, responses: { "200": { description: "ok", content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } } } } },
        "/store/inventory": { get: { summary: "Returns pet inventories by status", security: [{ api_key: [] }], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "object", additionalProperties: { type: "integer" } } } } } } } },
        "/user/login": { get: { summary: "Logs user into the system", parameters: [{ name: "username", in: "query", schema: { type: "string" } }, { name: "password", in: "query", schema: { type: "string" } }], responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "string" } } } } } } },
      },
    }, null, 2),
  },
  {
    id: "rideshare",
    name: "RideShare Dispatch API",
    description: "Ride-hailing backend: quotes, ride requests, driver location and trip payments.",
    spec: `openapi: 3.1.0
info:
  title: RideShare Dispatch API
  version: 1.3.0
paths:
  /quotes:
    post:
      summary: Get a fare quote
      requestBody: { content: { application/json: { schema: { type: object, required: [pickup, dropoff], properties: { pickup: { type: object, properties: { lat: { type: number }, lng: { type: number } } }, dropoff: { type: object, properties: { lat: { type: number }, lng: { type: number } } } } } } } }
      responses:
        "200": { description: Quote, content: { application/json: { schema: { type: object, required: [quoteId, fare, currency, etaMinutes], properties: { quoteId: { type: string }, fare: { type: number }, currency: { type: string }, etaMinutes: { type: integer }, surge: { type: number } } } } } }
  /rides:
    post:
      summary: Request a ride
      requestBody: { content: { application/json: { schema: { type: object, required: [quoteId], properties: { quoteId: { type: string }, paymentMethodId: { type: string } } } } } }
      responses:
        "201": { description: Ride, content: { application/json: { schema: { type: object, required: [rideId, status], properties: { rideId: { type: string }, status: { type: string, enum: [searching, matched, arriving, in_progress, completed] }, driverId: { type: string } } } } } }
  /rides/{rideId}:
    get:
      summary: Get ride status
      parameters: [{ name: rideId, in: path, required: true, schema: { type: string } }]
      responses:
        "200": { description: Ride, content: { application/json: { schema: { type: object, required: [rideId, status], properties: { rideId: { type: string }, status: { type: string }, driverLocation: { type: object, properties: { lat: { type: number }, lng: { type: number } } }, etaMinutes: { type: integer } } } } } }
  /rides/{rideId}/cancel:
    post:
      summary: Cancel a ride
      parameters: [{ name: rideId, in: path, required: true, schema: { type: string } }]
      responses:
        "200": { description: Cancelled, content: { application/json: { schema: { type: object, properties: { rideId: { type: string }, cancellationFee: { type: number } } } } } }
  /drivers/nearby:
    get:
      summary: List nearby drivers
      parameters: [{ name: lat, in: query, schema: { type: number } }, { name: lng, in: query, schema: { type: number } }]
      responses:
        "200": { description: Drivers, content: { application/json: { schema: { type: array, items: { type: object, required: [driverId, lat, lng], properties: { driverId: { type: string }, lat: { type: number }, lng: { type: number }, rating: { type: number }, vehicle: { type: string } } } } } } }
  /trips/{tripId}/charge:
    post:
      summary: Charge the rider for a completed trip
      parameters: [{ name: tripId, in: path, required: true, schema: { type: string } }]
      responses:
        "201": { description: Charge, content: { application/json: { schema: { type: object, required: [chargeId, amount, status], properties: { chargeId: { type: string }, amount: { type: number }, status: { type: string } } } } } }
`,
  },
];
