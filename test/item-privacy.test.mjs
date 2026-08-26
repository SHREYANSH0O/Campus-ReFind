import assert from "node:assert/strict";
import test from "node:test";
import { presentItem, protectedDetailsMessage } from "../item-privacy.mjs";

const sampleItem = {
  id: 14,
  report_type: "lost",
  title: "Black wallet",
  category: "Accessories",
  color: "Black",
  brand: "Wildhorn",
  description: "Lost near the library steps.",
  location: "Central Library",
  reported_date: "2026-08-26",
  status: "open",
  image_url: "https://example.com/wallet.png",
  user_id: 3,
  reporter_name: "Amit Singh",
  pending_claims: 1,
  private_notes: "Student ID and serial number",
};

test("guests only receive summary data for an item", () => {
  const guestView = presentItem(sampleItem, null);

  assert.deepEqual(guestView, {
    id: 14,
    report_type: "lost",
    title: "Black wallet",
    location: "Central Library",
    reported_date: "2026-08-26",
    image_url: "https://example.com/wallet.png",
    pending_claims: 1,
    is_owner: false,
    can_claim: false,
    details_protected: true,
    protected_details_message: protectedDetailsMessage,
  });
  assert.equal("description" in guestView, false);
  assert.equal("brand" in guestView, false);
  assert.equal("category" in guestView, false);
  assert.equal("status" in guestView, false);
  assert.equal("reporter_name" in guestView, false);
  assert.equal("private_notes" in guestView, false);
});

test("signed-in viewers receive the fuller report details", () => {
  const signedInView = presentItem(sampleItem, { id: 9, role: "student" });

  assert.equal(signedInView.details_protected, false);
  assert.equal(signedInView.description, "Lost near the library steps.");
  assert.equal(signedInView.category, "Accessories");
  assert.equal(signedInView.color, "Black");
  assert.equal(signedInView.brand, "Wildhorn");
  assert.equal(signedInView.status, "open");
  assert.equal(signedInView.reporter_name, "Amit Singh");
  assert.equal(signedInView.can_claim, false);
});

test("claim actions stay available for other signed-in users on found items", () => {
  const claimable = presentItem({ ...sampleItem, report_type: "found" }, { id: 21, role: "student" });

  assert.equal(claimable.can_claim, true);
  assert.equal(claimable.is_owner, false);
});
