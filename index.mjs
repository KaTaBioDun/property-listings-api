import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "node:crypto";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE = "property-listings";
const TYPES = ["land", "building", "rental"];
const STATUSES = ["available", "sold"];
const FIELDS = ["title", "location", "price", "type", "status"];

const respond = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

// API Gateway (HTTP API) sets event.routeKey, for example "GET /listings/{id}".
export const handler = async (event) => {
  try {
    switch (event.routeKey) {
      case "POST /listings":
        return await createListing(event);
      case "GET /listings":
        return await listListings();
      case "GET /listings/{id}":
        return await getListing(event);
      case "PUT /listings/{id}":
        return await updateListing(event);
      case "DELETE /listings/{id}":
        return await deleteListing(event);
      default:
        return respond(404, { message: "Route not found" });
    }
  } catch (err) {
    // Thrown when a ConditionExpression fails, i.e. the listingId does not exist.
    if (err.name === "ConditionalCheckFailedException") {
      return respond(404, { message: "Listing not found" });
    }
    console.error(err);
    return respond(500, { message: "Internal server error" });
  }
};

function parseBody(event) {
  try {
    return { data: JSON.parse(event.body ?? "{}") };
  } catch {
    return { error: "Request body must be valid JSON" };
  }
}

// Returns an error message for the first invalid field, or null if all are valid.
function validateFields(data) {
  if ("title" in data && (typeof data.title !== "string" || !data.title.trim())) {
    return "title must be a non-empty string";
  }
  if ("location" in data && (typeof data.location !== "string" || !data.location.trim())) {
    return "location must be a non-empty string";
  }
  if ("price" in data && (typeof data.price !== "number" || data.price < 0)) {
    return "price must be a number of 0 or more";
  }
  if ("type" in data && !TYPES.includes(data.type)) {
    return `type must be one of: ${TYPES.join(", ")}`;
  }
  if ("status" in data && !STATUSES.includes(data.status)) {
    return `status must be one of: ${STATUSES.join(", ")}`;
  }
  return null;
}

async function createListing(event) {
  const { data, error } = parseBody(event);
  if (error) return respond(400, { message: error });

  for (const field of ["title", "location", "price", "type"]) {
    if (!(field in data)) return respond(400, { message: `${field} is required` });
  }
  const invalid = validateFields(data);
  if (invalid) return respond(400, { message: invalid });

  const item = {
    listingId: randomUUID(),
    title: data.title.trim(),
    location: data.location.trim(),
    price: data.price,
    type: data.type,
    status: data.status ?? "available",
    createdAt: new Date().toISOString(),
  };

  await client.send(new PutCommand({ TableName: TABLE, Item: item }));
  return respond(201, item);
}

async function listListings() {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await client.send(new ScanCommand({ TableName: TABLE, ExclusiveStartKey }));
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  items.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  return respond(200, items);
}

async function getListing(event) {
  const id = event.pathParameters?.id;
  const res = await client.send(
    new GetCommand({ TableName: TABLE, Key: { listingId: id } })
  );
  if (!res.Item) return respond(404, { message: "Listing not found" });
  return respond(200, res.Item);
}

async function updateListing(event) {
  const id = event.pathParameters?.id;
  const { data, error } = parseBody(event);
  if (error) return respond(400, { message: error });

  const changes = FIELDS.filter((field) => field in data);
  if (changes.length === 0) {
    return respond(400, { message: `Provide at least one of: ${FIELDS.join(", ")}` });
  }
  const invalid = validateFields(data);
  if (invalid) return respond(400, { message: invalid });

  // Placeholders (#name, :value) avoid clashes with DynamoDB reserved words
  // such as "location", "status" and "type".
  const names = { "#updatedAt": "updatedAt" };
  const values = { ":updatedAt": new Date().toISOString() };
  const sets = ["#updatedAt = :updatedAt"];
  for (const field of changes) {
    names[`#${field}`] = field;
    values[`:${field}`] = typeof data[field] === "string" ? data[field].trim() : data[field];
    sets.push(`#${field} = :${field}`);
  }

  const res = await client.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { listingId: id },
      UpdateExpression: `SET ${sets.join(", ")}`,
      ConditionExpression: "attribute_exists(listingId)",
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    })
  );
  return respond(200, res.Attributes);
}

async function deleteListing(event) {
  const id = event.pathParameters?.id;
  await client.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { listingId: id },
      ConditionExpression: "attribute_exists(listingId)",
    })
  );
  return respond(200, { message: "Listing deleted" });
}
