output "api_endpoint" {
  value = aws_apigatewayv2_api.this.api_endpoint
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "role_name" {
  value = aws_iam_role.lambda.name
}
