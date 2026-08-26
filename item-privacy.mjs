const claimableStatuses = new Set(["open", "matched", "claimed"]);

export const protectedDetailsMessage = "Sign in to view the full report details and start a verified claim.";

export function isItemOwnerOrAdmin(item, user) {
  return Boolean(user && (user.id === item.user_id || user.role === "admin"));
}

export function canClaimItem(item, user) {
  return Boolean(user && user.id !== item.user_id && item.report_type === "found" && claimableStatuses.has(item.status));
}

export function canViewFullItemDetails(user) {
  return Boolean(user);
}

export function presentItem(item, user) {
  const detailsProtected = !canViewFullItemDetails(user);
  const result = {
    id: item.id,
    report_type: item.report_type,
    title: item.title,
    location: item.location,
    reported_date: item.reported_date,
    image_url: item.image_url || "",
    pending_claims: Number(item.pending_claims || 0),
    is_owner: isItemOwnerOrAdmin(item, user),
    can_claim: canClaimItem(item, user),
    details_protected: detailsProtected,
  };

  if (detailsProtected) {
    return { ...result, protected_details_message: protectedDetailsMessage };
  }

  return {
    ...result,
    category: item.category,
    color: item.color,
    brand: item.brand,
    description: item.description,
    status: item.status,
    reporter_name: item.reporter_name,
  };
}
